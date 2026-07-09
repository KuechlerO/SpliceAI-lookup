This repo contains: 
- client-side code for [spliceailookup.broadinstitute.org](https://spliceailookup.broadinstitute.org/) - contained within [index.html](index.html), [index.js](index.js), and [index.css](index.css).
- server-side code for SpliceAI and Pangolin REST APIs - contained within the [google_cloud_run_services/](google_cloud_run_services/) subdirectory and hosted on Google Cloud Run. 
- the original Flask web app that previously powered spliceailookup.broadinstitute.org - contained within the [original_flask_app/](original_flask_app/) subdirectory. 

---

### SpliceAI-Lookup Service (local deployment)

SpliceAI-Lookup Service  
implemented at Charité - Institut für Medizinische Genetik und Humangenetik  
- coded by Oliver Küchler (Problems/Questions: oliver.kuechler@charite.de)

This fork serves the UI locally and proxies SpliceAI requests to dedicated API containers. Pangolin and liftover still use the Broad Institute Cloud Run endpoints configured in [index.html](index.html).

#### Architecture

```
Browser → nginx (:80)
            ├─ /spliceai-lookup/          → modified-spliceai-lookup (frontend + Flask shim)
            ├─ /spliceai-lookup/api/37/   → spliceai-37-api (weisburd/spliceai-37)
            └─ /spliceai-lookup/api/38/   → spliceai-38-api (weisburd/spliceai-38)
                                              └─ postgres (transcript tables + cache)
```

SAI-10k-calc needs per-transcript **exon and CDS coordinates**. The stock `weisburd` Docker images load those from PostgreSQL (`transcripts_hg37` / `transcripts_hg38`). Without that database, SAI-10k can still classify aberration types using a fallback in [google_cloud_run_services/server.py](google_cloud_run_services/server.py), but frameshift / start-codon labels will show as "non-coding change" because CDS bounds are missing.

#### Docker Compose deployment

Files:

| File | Purpose |
|------|---------|
| [docker-compose.yml](docker-compose.yml) | Full stack: frontend, SpliceAI APIs, PostgreSQL, Redis, nginx |
| [.env.example](.env.example) | Template for `SPLICEAI_DB_PASSWORD` and optional proxy settings |
| [deploy/nginx.conf.example](deploy/nginx.conf.example) | nginx reverse-proxy config (copy to `nginx.conf`) |
| [google_cloud_run_services/.env.example](google_cloud_run_services/.env.example) | DB host for `update_transcript_tables` |

**1. Configure environment**

```bash
cp .env.example .env
# Edit .env — set SPLICEAI_DB_PASSWORD to a strong password

cp deploy/nginx.conf.example nginx.conf
```

**2. Start PostgreSQL**

```bash
docker compose up -d postgres
```

Verify the password (no `psql` on the host required):

```bash
docker compose exec -e PGPASSWORD="$SPLICEAI_DB_PASSWORD" postgres \
  psql -U postgres -d spliceai-lookup-db -c 'SELECT 1;'
```

**3. One-time: load SAI-10k transcript tables**

The sorted genePred files are **not** inside the `weisburd` API images. Download them from Broad's public bucket:

```bash
cd google_cloud_run_services
mkdir -p docker/ref/GRCh38 docker/ref/GRCh37

wget -O docker/ref/GRCh38/gencode.v49.GRCh38.sorted.txt.gz \
  https://storage.googleapis.com/tgg-viewer/ref/GRCh38/gencode_v49/gencode.v49.GRCh38.sorted.txt.gz

wget -O docker/ref/GRCh37/gencode.v49.GRCh37.sorted.txt.gz \
  https://storage.googleapis.com/tgg-viewer/ref/GRCh37/gencode_v49/gencode.v49.GRCh37.sorted.txt.gz
```

Configure credentials for [build_and_deploy.py](google_cloud_run_services/build_and_deploy.py):

```bash
cp .env.example .env          # inside google_cloud_run_services/
# Set SPLICEAI_LOOKUP_DB_HOST=localhost

echo 'your-db-password' > .pgpass   # same value as SPLICEAI_DB_PASSWORD in compose .env
chmod 600 .pgpass

pip install pandas psycopg2-binary tqdm python-dotenv
python3 build_and_deploy.py update_transcript_tables --gencode-version v49
```

Confirm rows were loaded:

```bash
docker compose exec postgres psql -U postgres -d spliceai-lookup-db \
  -c "SELECT COUNT(*) FROM transcripts_hg38;"
```

After this step you can remove the `ports: "5432:5432"` mapping from the `postgres` service in [docker-compose.yml](docker-compose.yml) if you do not need host access to the database.

**4. Start the full stack**

```bash
docker compose up -d --build
```

Open the site via nginx on port 80, or test APIs directly:

- hg38: http://localhost:8038/spliceai/?hg=38&variant=chr8-140300616-T-G  
- hg37: http://localhost:8037/spliceai/?hg=37&variant=11-63342520-T-C  

**5. Verify SAI-10k**

Query a variant in the UI and inspect the browser console. A successful setup shows:

- `sai10kPredictions.aberrations` with at least one entry (when applicable)
- `sai10kPredictions.transcript_info.cds_start` / `cds_end` populated
- `transcript_info.is_coding: true` for protein-coding transcripts

#### Patched API server without rebuilding images

[docker-compose.yml](docker-compose.yml) bind-mounts [google_cloud_run_services/server.py](google_cloud_run_services/server.py) and [sai10k_predictions.py](google_cloud_run_services/sai10k_predictions.py) into both API containers. This picks up local fixes (including the annotation-file fallback) without building custom images. For production parity with Broad, keep PostgreSQL populated as described above so CDS-based SAI-10k labels match [spliceailookup.broadinstitute.org](https://spliceailookup.broadinstitute.org).

To use the stock Hub images without mounts, remove the `volumes:` blocks under `spliceai-37-api` and `spliceai-38-api`.

#### Frontend-only quickstart (development)

Without Docker:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000/index.html. SpliceAI API calls will fail unless nginx/API containers are running and `index.html` points to them.

#### Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| SAI-10k always "No prediction" | API containers not using patched `server.py` and no PostgreSQL transcript tables |
| SAI-10k predictions but "non-coding change" only | Transcript tables missing CDS data — run `update_transcript_tables` |
| `password authentication failed` during `update_transcript_tables` | `.pgpass` password does not match `POSTGRES_PASSWORD`; or host port 5432 points at a different Postgres instance |
| `GenePred file not found` | Download sorted genePred files (step 3) — they are not in the `weisburd` images |
| hg19 IGV errors | Ensure latest [index.js](index.js) is deployed (GRCh37 reference uses `fastaURL`/`indexURL`, not `twoBitURL`) |
| `POSTGRES_PASSWORD` ignored after change | Volume was initialized with an old password — recreate the `postgres-data` volume |

---

#### SpliceAI, Pangolin APIs


<b>NOTE:</b> These APIs are intended for interactive use only, and do not support more than several requests per user per minute. More frequent queries will trigger a "rate limit" error in the response. To process large batches of variants, please set up and query your own local instance of the API server. This is easy to do using the publicly available docker images (see below for details). Alternatively, you can intall and run the underlying SpliceAI and/or Pangolin models directly on your local infrastructure. Their source code is available @ [https://github.com/bw2/SpliceAI](https://github.com/bw2/SpliceAI) and [https://github.com/bw2/Pangolin](https://github.com/bw2/Pangolin). <br />
<br />

The SpliceAI and Pangolin APIs have different base urls for different genome versions:

`https://spliceai-37-xwkwwwxdwq-uc.a.run.app/spliceai/?hg=37&variant=` - SpliceAI for variants on GRCh37<br />
`https://spliceai-38-xwkwwwxdwq-uc.a.run.app/spliceai/?hg=38&variant=` - SpliceAI for variants on GRCh38<br />
`https://pangolin-37-xwkwwwxdwq-uc.a.run.app/pangolin/?hg=37&variant=` - Pangolin for variants on GRCh37<br />
`https://pangolin-38-xwkwwwxdwq-uc.a.run.app/pangolin/?hg=38&variant=` - Pangolin for variants on GRCh38 <br />

To query the API, append your variant of interest in `chrom-pos-ref-alt` format to the appropriate base url above.

For example, to get SpliceAI scores for `chr8-140300616-T-G`:<br>

*[https://spliceai-38-xwkwwwxdwq-uc.a.run.app/spliceai/?hg=38&variant=chr8-140300616-T-G](https://spliceai-38-xwkwwwxdwq-uc.a.run.app/spliceai/?hg=38&variant=chr8-140300616-T-G)*
  
or to get Pangolin scores while also setting the `distance` and `mask` parameters:<br>

*[https://pangolin-38-xwkwwwxdwq-uc.a.run.app/pangolin/?hg=38&variant=chr8-140300616-T-G&distance=1000&mask=1](https://pangolin-38-xwkwwwxdwq-uc.a.run.app/pangolin/?hg=38&variant=chr8-140300616-T-G&distance=1000&mask=1)*

#### API parameters

Parameter descriptions:  

- **variant** (required) a variant in the format "chrom-pos-ref-alt"  
- **hg** (required) can be 37 or 38  
- **distance** (optional) distance parameter of SpliceAI model (default: 50)   
- **mask** (optional) can be 0 which means raw scores or 1 which means masked scores (default: 0). 
Splicing changes corresponding to strengthening annotated splice sites and weakening unannotated splice sites are typically much less pathogenic than weakening annotated splice sites and
strengthening unannotated splice sites. When this parameter is = 1 (masked), the delta scores of such splicing changes are set to 0. SpliceAI developers recommend using raw (0) for alternative splicing analysis and masked (1) for variant interpretation.  


---
#### Running Your Own Local API Server

If you have [docker](https://docs.docker.com/engine/install/) installed, you can easily start your own SpliceAI-lookup API server by running one of these commands (depending on which model and genome version you want to query):

```
docker run -p 8080:8080 docker.io/weisburd/spliceai-38:latest
docker run -p 8080:8080 docker.io/weisburd/spliceai-37:latest
docker run -p 8080:8080 docker.io/weisburd/pangolin-38:latest
docker run -p 8080:8080 docker.io/weisburd/pangolin-37:latest
```

On startup the container loads the model and prints some TensorFlow / model-loading warnings (e.g. `WARNING:absl:No training configuration found...`); these can be ignored. Once it is listening on port 8080, you can query it. For example, if you started the `spliceai-38` image, you can open http://localhost:8080/spliceai/?hg=38&variant=chr8-140300616-T-G in your browser. Each per-genome/per-tool image only answers requests for its own tool and `hg` value. 

Optional environment variables (pass with `docker run -e NAME=value ...`):
- `DISABLE_RATE_LIMIT=1` — explicitly turn off per-IP rate limiting. Only relevant if you connect your own database (see below); without a database, rate limiting is already disabled.
- `DATABASE_ENABLED=1` / `0` — force the database on or off. Defaults to on when `DB_PASSWORD` is set and off otherwise.
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — connection settings for an optional PostgreSQL database (see below).


##### Optionally attaching your own PostgreSQL database

A database is not required, but attaching one to a local instance adds response caching, so repeated queries for the same variant return instantly. To attach a local PostgreSQL:

1. Create an empty database, e.g. `createdb spliceai-lookup-db`.
2. Point the container at it. From a Docker container, the host's PostgreSQL is reachable at `host.docker.internal` (on Docker Desktop for Mac/Windows; on Linux add `--add-host=host.docker.internal:host-gateway`):
   ```
   docker run -p 8080:8080 \
     -e DATABASE_ENABLED=1 \
     -e DB_HOST=host.docker.internal \
     -e DB_PORT=5432 \
     -e DB_NAME=spliceai-lookup-db \
     -e DB_USER=postgres \
     -e DB_PASSWORD=yourpassword \
     docker.io/weisburd/spliceai-38:latest
   ```
   If your PostgreSQL uses passwordless (`trust`) auth, omit `-e DB_PASSWORD` and keep `-e DATABASE_ENABLED=1`.

The server creates the tables it needs automatically on the first request (`cache`, `log`, `restricted_ips`, `whitelist_ips`) — no manual schema setup is required.

The `transcripts_hg37`/`transcripts_hg38` tables used for SAI-10k transcript-structure enrichment are *not* created automatically; without them SAI-10k falls back to the bundled annotations. To populate them, see the `update_transcript_tables` command in [build_and_deploy.py](https://github.com/broadinstitute/SpliceAI-lookup/blob/master/google_cloud_run_services/build_and_deploy.py).

If you would like to run your own API instance on Google Cloud instead of locally, see the [build_and_deploy.py](https://github.com/broadinstitute/SpliceAI-lookup/blob/master/google_cloud_run_services/build_and_deploy.py#L224-L238) script which we use to deploy and update the SpliceAI-lookup API on [Google Cloud Run](https://cloud.google.com/run?hl=en). Submit a GitHub issue if you have any questions.

---
#### Code Overview For Developers

The [spliceailookup.broadinstitute.org](https://spliceailookup.broadinstitute.org) front-end is contained within [index.html](index.html). It uses ES6 javascript with [Semantic UI](https://semantic-ui.com) and [jQuery](https://en.wikipedia.org/wiki/JQuery). Also, it uses a [custom version of igv.js](https://github.com/bw2/igv.js) that includes new track types for visualizing the SpliceAI & Pangolin scores. The new server-side code is in the [google_cloud_run_services/](google_cloud_run_services/) subdirectory and includes Dockerfiles for building API server images, as well as the [build_and_deploy.py](https://github.com/broadinstitute/SpliceAI-lookup/blob/master/google_cloud_run_services/build_and_deploy.py#L224-L238) script for deploying SpliceAI and Pangolin API services to [Google Cloud Run](https://cloud.google.com/run?hl=en). 
The API server logic is in [google_cloud_run_services/server.py](https://github.com/broadinstitute/SpliceAI-lookup/blob/master/google_cloud_run_services/server.py) and uses the [Flask](https://flask.palletsprojects.com/en/3.0.x) library.


