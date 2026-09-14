// store user settings at the time of the last 'submit', as well as the resulting responses from the server
let lastGenomeVersion, lastSpliceaiResponseJson, lastPangolinResponseJson
let batchVariantResults = []
let currentBatchIndex = 0
let lastBatchFormOptions = null
const BATCH_VARIANT_MAX = 75

/** "main" = MANE Select (etc.) rows only; "all" = all transcripts — persists while switching batch variants */
let transcriptFilterPreference = "main"

// Tracks position-only (REF-only) mode across submits and batch navigation so the delta-score
// checkbox state is captured/restored only on an actual normal <-> position-only transition (see
// updateControlsForPositionOnlyMode and updateVisualizationCheckboxes).
let wasPositionOnly = false
const deltaTrackCheckedBeforePositionOnly = {}  // name -> checked state captured at the transition into position-only mode

// Define constants 
const GENCODE_VERSION = "v49"

const VARIANT_RE = new RegExp(
    "^[\\s]*" +
    "(chr)?([0-9XYMTt]{1,2})" +
    "[-\\p{Pd}\\s:]+" +
    "([0-9,]+)" +
    "[-\\p{Pd}\\s:]*" +
    "([ACGT]+)" +
    "[-\\p{Pd}\\s:>]+" +
    "([ACGT]+)",
    'iu'
)

// Matches a bare chrom+pos with no ref/alt (e.g. "chr8:140300615", "chr8 140300615",
// "chr8-140300615") -- requests REF-only scores instead of REF-vs-ALT delta scores.
// Anchored at both ends, which is the only thing keeping a full chrom-pos-ref-alt
// variant off the REF-only path: a full variant is excluded solely because its trailing
// -REF-ALT leaves the "[\s]*$" anchor unsatisfied. Do not loosen that anchor.
const POSITION_ONLY_RE = new RegExp(
    "^[\\s]*" +
    "(chr)?([0-9XYMTt]{1,2})" +
    "[-\\p{Pd}\\s:]+" +
    "([0-9,]+)" +
    "[\\s]*$",
    'iu'
)

const LOC_ONLY_RE = /^(?:chr)?[0-9XYMT]{1,2}[-\s:,]+[0-9,]+$/i
const ALLELE_RE = /^[ACGT]+$/i

// Original (delta-score) tooltip content for the shared score/position header question-icons,
// captured once at load so the REF-only header swap can be reversed exactly by a later
// normal-mode search.
const ORIGINAL_HEADER_TOOLTIPS = {}
for (const tool of ["spliceai", "pangolin"]) {
    ORIGINAL_HEADER_TOOLTIPS[tool] = {
        score: $(`#${tool}-score-header-icon`).attr("data-html"),
        position: $(`#${tool}-position-header-icon`).attr("data-content"),
    }
}

const TRANSCRIPT_PRIORITY = {
    "MS": 3,
    "MP": 2,
    "C": 1,
    "N": 0,
}

const nameMapForPredictorScores = {
    "primateai3d": "PrimateAI-3D",
    "promoterai": "PromoterAI",
    "cadd": "CADD",
    "revel": "REVEL",
    "revel_max": "REVEL",
    "sift_max": "SIFT (max)",
    "phylop": "PhyloP",
    //"gnomad": "gnomAD",
    "polyphen_max": "PolyPhen (max)",
    "alphamissense": "AlphaMissense",
}


const predictorPointsToColor = {
    "+8": "#ff8177",  // Very Strong Pathogenic (red)
    "+4": "#ffd7d1",  // Strong Pathogenic (light red)
    "+3": "#ffdcb8",  // Pathogenic (light orange-red)
    "+2": "#ffebc5",  // Moderate Pathogenic (light orange)
    "+1": "#fff5dc",  // Supporting Pathogenic (light yellow)
    "0": "#f0f0f0",   // Indeterminate (very light gray)
    "-1": "#d8f3e8",  // Supporting Benign (very light surf green)
    "-2": "#c4eddd",  // Moderate Benign (pale surf green)
    "-3": "#aee8d2",  // Benign (light surf green)
    "-4": "#9ae2c6",   // Strong Benign (soft surf green)
    "-8": "#6fd9ab",   // Very Strong Benign (green)
}

const predictorPointsToLabel = {
    "+8":  "Very Strong Pathogenic",
    "+4":  "Strong Pathogenic",
    "+3":  "Pathogenic",
    "+2":  "Moderate Pathogenic",
    "+1":  "Supporting Pathogenic",
    "0":  "Indeterminate",
    "-1": "Supporting Benign",
    "-2": "Moderate Benign",
    "-3": "Benign",
    "-4": "Strong Benign",
    "-8": "Very Strong Benign",
}

const predictorScoreToPoints = {
    "cadd": (record) => {
        const score = parseFloat(record.score)
        if (score >= 28.1) {            //moderate (pathogenic)
            return "+2"
        } else if (score >= 25.3) {     //supporting (pathogenic)
            return "+1"
        } else if (score > 22.7) {      //indeterminate
            return "0"
        } else if (score > 17.3) {      // supporting (benign)
            return "-1"
        } else if (score > 0.15) {      // moderate (benign)
            return "-2"
        } else {                        // strong (benign)
            return "-4"
        }
    },
    "revel_max": (record) => {
        const score = parseFloat(record.score)
        if (score >= 0.932) {           // strong (pathogenic)
            return "+4"
        } else if (score >= 0.773) {    // moderate (pathogenic)
            return "+2"
        } else if (score >= 0.644) {    // supporting (pathogenic)
            return "+1"
        } else if (score > 0.290) {     // indeterminate
            return "0"
        } else if (score > 0.183) {     // supporting (benign)
            return "-1"
        } else if (score > 0.16) {      // moderate (benign)
            return "-2"
        } else if (score > 0.003) {      // strong (benign)
            return "-4"
        } else {                        // very strong (benign)
            return "-8"
        }
    },
    "sift_max": (record) => {
        const score = parseFloat(record.score)
        if (score <= 0) {   // moderate (pathogenic)
            return "+2"
        } else if (score < 0.001) { // supporting (pathogenic)
            return "+1"
        } else if (score < 0.08) { // indeterminate
            return "0"
        } else if (score < 0.327) { // supporting (benign)
            return "-1"
        } else { // moderate (benign)
            return "-2"
        }
    },
    "polyphen_max": (record) => {
        const score = parseFloat(record.score)
        if (score >= 0.999) {  // moderate (pathogenic)
            return "+2"
        } else if (score >= 0.978) {  // supporting (pathogenic)
            return "+1"
        } else if (score > 0.113) { // indeterminate
            return "0"
        } else if (score > 0.009) {  // supporting (benign)
            return "-1"
        } else {  // moderate (benign)
            return "-2"
        }
    },
    "phylop": (record) => {
        const score = parseFloat(record.score)
        if (score >= 9.741) {    //moderate (pathogenic)
            return "+2"
        } else if (score >= 7.367) {  //supporting (pathogenic)
            return "+1"
        } else if (score > 1.879) {  //indeterminate
            return "0"
        } else if (score > 0.021) {  //supporting (benign)
            return "-1"
        } else { // moderate (benign)
            return "-2"
        }
    },
    "alphamissense": (record) => {
        const score = parseFloat(record.score)
        if (score >= 0.99) {     // +4 (strong)
            return "+4"
        } else if (score >= 0.972) {  // +3
            return "+3"
        } else if (score >= 0.906) {  // +2 (moderate)
            return "+2"
        } else if (score >= 0.792) {  // +1 (supporting)
            return "+1"
        } else if (score >= 0.170) {   // indeterminate
            return "0"
        } else if (score >= 0.1) {  // supporting (benign)
            return "-1"
        } else if (score >= 0.071) {  // moderate (benign)
            return "-2"
        } else {  //  -3 (benign)
            return "-3"
        }
    },
}


//seqr thresholds: https://github.com/broadinstitute/seqr/blob/master/ui/shared/utils/constants.js#L1493-L1531
//gnomAD browser thresholds: https://github.com/broadinstitute/gnomad-browser/blob/main/browser/src/VariantPage/VariantInSilicoPredictors.tsx#L22-L60
const colorMapForPredictorScores = {
    "primateai3d": (record) => {
        if (record.percentile >= record.genePercentileThreshold) { // + 0.1) {
            return "#fccfb8"  // light red
        //} else if (record.percentile >= record.genePercentileThreshold - 0.1) {
        //    return "#fff19d" // light yellow
        } else {
            return "#ffffff"  // white
        }
    },
    "promoterai": (record) => {
        const absScore = Math.abs(parseFloat(record.score))
        if (absScore >= 0.5) {
            return "#fccfb8"    // light red
        } else if (absScore >= 0.1) {
            return "#fff19d"    // light yellow
        } else {
            return "#ffffff"   // white
        }
    },
    "cadd": (record) => predictorPointsToColor[predictorScoreToPoints["cadd"](record)],
    "revel_max": (record) => predictorPointsToColor[predictorScoreToPoints["revel_max"](record)],
    "sift_max": (record) => predictorPointsToColor[predictorScoreToPoints["sift_max"](record)],
    "polyphen_max": (record) => predictorPointsToColor[predictorScoreToPoints["polyphen_max"](record)],
    "phylop": (record) => predictorPointsToColor[predictorScoreToPoints["phylop"](record)],
    "alphamissense": (record) => predictorPointsToColor[predictorScoreToPoints["alphamissense"](record)],
}

const computeHelpTextForPredictorScores = (predictor, record) => {
    // example "This CADD score is in the 'moderate pathogenic' range (+2 points) with a score of 25.3"
    const points = predictorScoreToPoints[predictor](record)
    const label = predictorPointsToLabel[points]
    const predictorLabel = nameMapForPredictorScores[predictor] || predictor
    let helpText = `The ${record.score} ${nameMapForPredictorScores[predictor] || predictor} score is in the ${label} range and would count for ${points} points based on thresholds and points established for missense variants in <a href='https://www.biorxiv.org/content/10.1101/2024.09.17.611902v1.full' target='_blank'>Bergquist et al. 2024</a> and <a href='https://pmc.ncbi.nlm.nih.gov/articles/PMC9748256/' target='_blank'>Pejaver et al. 2022</a>`
    // generate a color legend as an html table:
    helpText += `<br /><br /><b>Legend:</b><br /><br />`
    helpText += `<table style='border: 1px !important; border-collapse: collapse;'>`
    for (const points of ["+8", "+4", "+3", "+2", "+1", "0", "-1", "-2", "-3", "-4", "-8"]) {
        helpText += `<tr style='background-color:${predictorPointsToColor[points]}'><td style='padding:5px;margin:5px;border-radius:0px;min-width:170px'>${predictorPointsToLabel[points]}</td><td style='min-width:100px; text-align:right'>${points} points</td></tr>`
    }
    helpText += `</table>`
    return helpText
}

// TODO: Is this used?
const helpTextForPredictorScores = {
    "primateai3d": (record) => `<a href='https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10187174/' target='_blank'>PrimateAI-3D</a> gene-specific thresholds are provided by the authors. Values above the threshold are shown with a red background to indicate a 'likely deleterious' prediction.`,
    "promoterai": (record) => `<a href='https://www.science.org/doi/10.1126/science.ads7373' target='_blank'>PromoterAI</a>  &nbsp; <a href='https://github.com/Illumina/PromoterAI' target='_blank'><i class='github square icon'></i></a> &nbsp; scores range from -1 to 1 with 0 meaning no activity. Negative values represent under-expression and positive values represent over-expression. A threshold of +/-0.1 is used for high sensitivity, and +/-0.5 for high precision.`,
    "cadd": (record) => computeHelpTextForPredictorScores("cadd", record),
    "revel_max": (record) => computeHelpTextForPredictorScores("revel_max", record),
    "sift_max": (record) => computeHelpTextForPredictorScores("sift_max", record),
    "polyphen_max": (record) => computeHelpTextForPredictorScores("polyphen_max", record),
    "phylop": (record) => computeHelpTextForPredictorScores("phylop", record),
    "alphamissense": (record) => computeHelpTextForPredictorScores("alphamissense", record),
}

const formatScore = (score) => {
    if (score == null) {
        return ""
    }
    return Math.abs(parseFloat(score)).toFixed(2)
}

/* Every SpliceAI and Pangolin score in the UI is shown rounded to 2 decimals, so thresholds are
   applied to the rounded value rather than to the raw score the API returned: comparing the raw
   value left a 0.195 rendered as "0.20" sitting in an unhighlighted cell. */
const roundScore = (score) => parseFloat(parseFloat(score).toFixed(2))

const escapeHtml = (value) => {
    if (value === null || value === undefined) return ""
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

const truncateAllele = (allele, maxLength = 30) => {
    if (allele.length <= maxLength) {
        return allele
    }
    return `${allele.substring(0, maxLength)}...(${allele.length.toLocaleString()}bp)`
}

const formatVariantDisplay = (chrom, pos, ref, alt, maxLength = 30) => {
    return `${chrom}:${pos} ${truncateAllele(ref, maxLength)} > ${truncateAllele(alt, maxLength)}`
}

const truncateVariantString = (variantStr, maxAlleleLength = 30) => {
    // Try to parse and truncate variant in common formats
    const patterns = [
        /^(chr)?(\d+|[XYxy]|MT?)-(\d+)-([ACGTacgt]+)-([ACGTacgt]+)$/,  // chr1-12345-A-T
        /^(chr)?(\d+|[XYxy]|MT?):(\d+)[: ]([ACGTacgt]+)[>\/]([ACGTacgt]+)$/,  // chr1:12345 A>T or chr1:12345:A:T
    ]
    for (const pattern of patterns) {
        const match = variantStr.match(pattern)
        if (match) {
            const [, chrPrefix, chromNum, pos, ref, alt] = match
            const chrom = (chrPrefix || '') + chromNum
            return formatVariantDisplay(chrom, pos, ref, alt, maxAlleleLength)
        }
    }
    return variantStr
}

const getScoreStyle = (score) => {
    score = parseFloat(score)

    if (Math.abs(score) < 0.01) {
        return `style='color:#BBBBBB;'`
    }

    let color
    if (Math.abs(score) >= 0.8) {
        color = "#fccfb8"
    } else if (Math.abs(score) >= 0.5) {
        color = "#fff19d"
    } else if (Math.abs(score) >= 0.2) {
        color = "#cdffd7"
    } else {
        return ""
    }

    return `style='white-space:nowrap;background-color:${color};'`
}

// Preparing TabixIndexedFile property for use in rest of code
const { TabixIndexedFile } = window.gmodTABIX

const primateAndPromoterAiTableUrls = {
    '37': 'https://storage.googleapis.com/spliceai-lookup-reference-data/PrimateAI_and_PromoterAI_scores.hg19.20250627.tsv.gz',
    '38': 'https://storage.googleapis.com/spliceai-lookup-reference-data/PrimateAI_and_PromoterAI_scores.hg38.20250627.tsv.gz',
}
const primateAndPromoterAiTables = {
    '37': new TabixIndexedFile({ url: primateAndPromoterAiTableUrls['37'], tbiUrl: `${primateAndPromoterAiTableUrls['37']}.tbi` }),
    '38': new TabixIndexedFile({ url: primateAndPromoterAiTableUrls['38'], tbiUrl: `${primateAndPromoterAiTableUrls['38']}.tbi` }),
}

const alphaMissenseTableUrls = {
    '37': 'https://storage.googleapis.com/spliceai-lookup-reference-data/AlphaMissense_hg19.tsv.gz',
    '38': 'https://storage.googleapis.com/spliceai-lookup-reference-data/AlphaMissense_hg38.tsv.gz',
}
const alphaMissenseTables  = {
    '37': new TabixIndexedFile({ url: alphaMissenseTableUrls['37'], tbiUrl: `${alphaMissenseTableUrls['37']}.tbi` }),
    '38': new TabixIndexedFile({ url: alphaMissenseTableUrls['38'], tbiUrl: `${alphaMissenseTableUrls['38']}.tbi` }),
}

const getUCSCBrowserUrl = (genomeVersion, chrom, pos) => {
    const genomeVers = genomeVersion.replace('37', '19')
    const chromWithoutPrefix = chrom.toUpperCase().replace('CHR', '')

    return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg${genomeVers}&position=chr${chromWithoutPrefix}:${pos}`
}

const showError = (errorMessage) => {
    $("#error-box").html( $("#error-box").html() + `<br />${errorMessage.toString()}<br />`)
    $("#error-box").show()
}

// Shown above the results rather than in #error-box: a note qualifies the scores on screen
// (eg. which allele a dbSNP id resolved to), so it has to be seen before them, not after.
const showNote = (noteMessage) => {
    $("#notes-box").html($("#notes-box").html() + `<br />${escapeHtml(noteMessage)}<br />`)
    $("#notes-box").show()
}

// Replaces rather than appends: a search is at one stage at a time, and the point is to say which
// of several slow external APIs is being waited on. .text() because it never carries user input.
const showProgress = (progressMessage) => $("#progress-box").text(progressMessage).show()

const clearProgress = () => $("#progress-box").hide().text("")

const genomeDisplayName = (genomeVersion) => {
    /* The name users know a genome build by, for error messages. The page numbers the builds 37
     * and 38 internally, so interpolating that number straight into a message produces "hg37",
     * which is not a real build name. Mirrors genome_display_name() in server.py. */
    return genomeVersion == '37' ? "hg19" : "hg38"
}

const GENEBE_API_PREFIX = "https://api.genebe.net/cloud/api-public/v1"
// A bare dbSNP id, which GeneBe's variant-relaxed endpoint accepts but which names a position
// rather than an allele. See resolveVariantWithGeneBe.
const RS_ID_RE = /^rs\d+$/i
const GENEBE_TIMEOUT_MS = 15000  // 15 second timeout for GeneBe API calls
const ENSEMBL_TIMEOUT_MS = 90000  // 90 second timeout for Ensembl API calls
const VARIANTVALIDATOR_TIMEOUT_MS = 30000  // 30 second timeout for the VariantValidator fallback
// Guidance appended to variant-resolution errors when HGVS lookup is unavailable.
const GENOMIC_COORDINATE_HINT = `Try entering the variant using genomic coordinates rather than HGVS (eg. "chrom-pos-ref-alt", "chrom:pos ref>alt", etc.)`

// Ensembl's VEP consequence ranking, most severe first, as returned by
// https://rest.ensembl.org/info/variation/consequence_types?rank=1
const CONSEQUENCE_SEVERITY_ORDER = [
    "transcript_ablation", "splice_acceptor_variant", "splice_donor_variant", "stop_gained",
    "frameshift_variant", "stop_lost", "start_lost", "transcript_amplification", "feature_elongation",
    "feature_truncation", "inframe_insertion", "inframe_deletion", "missense_variant",
    "protein_altering_variant", "splice_donor_5th_base_variant", "splice_region_variant",
    "splice_donor_region_variant", "splice_polypyrimidine_tract_variant",
    "incomplete_terminal_codon_variant", "start_retained_variant", "stop_retained_variant",
    "synonymous_variant", "coding_sequence_variant", "mature_miRNA_variant", "5_prime_UTR_variant",
    "3_prime_UTR_variant", "non_coding_transcript_exon_variant", "intron_variant",
    "NMD_transcript_variant", "non_coding_transcript_variant", "coding_transcript_variant",
    "upstream_gene_variant", "downstream_gene_variant", "TFBS_ablation", "TFBS_amplification",
    "TF_binding_site_variant", "regulatory_region_ablation", "regulatory_region_amplification",
    "regulatory_region_variant", "intergenic_variant", "sequence_variant",
]

// Terms GeneBe reports that Ensembl's ranking doesn't list, mapped to the VEP term they sit next to
// in severity. Without this they would sort below every VEP term, so a transcript whose only term is
// one of these would be ranked as the least severe thing on offer.
const NON_VEP_CONSEQUENCE_EQUIVALENTS = {
    "5_prime_UTR_premature_start_codon_gain_variant": "5_prime_UTR_variant",
    "exon_region": "non_coding_transcript_exon_variant",
    // GeneBe uses SnpEff's vocabulary, which splits VEP's two inframe terms into
    // conservative/disruptive pairs.
    "conservative_inframe_deletion": "inframe_deletion",
    "disruptive_inframe_deletion": "inframe_deletion",
    "conservative_inframe_insertion": "inframe_insertion",
    "disruptive_inframe_insertion": "inframe_insertion",
    // "within a gene but not within a transcript" -- VEP has no equivalent, so it sits at the
    // weakest transcript-level term rather than below everything.
    "intragenic_variant": "coding_transcript_variant",
}

// Unranked terms already reported by rank() below, so a variant with hundreds of transcripts
// warns once per unknown term rather than once per comparison.
const unrankedConsequenceTermsSeen = new Set()

const mostSevereConsequence = (consequenceTerms) => {
    /* Return the most severe of the consequence terms reported for a single transcript. Terms in
     * neither CONSEQUENCE_SEVERITY_ORDER nor NON_VEP_CONSEQUENCE_EQUIVALENTS rank below all the ones
     * that are, and ties keep the order the API returned them in.
     *
     * Args:
     *  consequenceTerms (array): one or more SO consequence terms. Must not be empty.
     */
    const rank = (term) => {
        const i = CONSEQUENCE_SEVERITY_ORDER.indexOf(
            NON_VEP_CONSEQUENCE_EQUIVALENTS[term] || term)
        if (i === -1) {
            if (!unrankedConsequenceTermsSeen.has(term)) {
                unrankedConsequenceTermsSeen.add(term)
                console.warn("Consequence term is not in the severity ranking, sorting it last:", term)
            }
            return CONSEQUENCE_SEVERITY_ORDER.length
        }
        return i
    }
    return consequenceTerms.reduce((mostSevere, term) => rank(term) < rank(mostSevere) ? term : mostSevere)
}

const alleleChange = (ref, alt) => {
    /* Describe what a variant changes, independent of how it's written: the bases an indel shares at
     * each end are stripped, so "CC>C" and "GC>G" (the same deleted C, written at different positions)
     * both come out as "C/". Used to tell a re-written variant apart from a different one.
     */
    let start = 0
    while (start < ref.length && start < alt.length && ref[start] == alt[start]) {
        start++
    }
    let end = 0
    while (end < ref.length - start && end < alt.length - start
           && ref[ref.length - 1 - end] == alt[alt.length - 1 - end]) {
        end++
    }
    return `${ref.slice(start, ref.length - end)}/${alt.slice(start, alt.length - end)}`
}

const transcriptIdKey = (transcriptId) => {
    /* Key used to match a transcript id returned by a consequence API against the t_id values in
     * SpliceAI / Pangolin responses. Dropping the version also drops the "_7" suffix that Gencode
     * adds to transcripts it maps back onto GRCh37 (eg. "ENST00000616016.5_7"). */
    return String(transcriptId).split(".")[0].toUpperCase()
}

const mostSevereConsequenceByTranscriptId = (transcriptConsequences) => {
    /* Reduce per-transcript consequence records to a single most-severe term per transcript.
     *
     * One transcript can span several records, and transcriptIdKey drops the version, so records
     * that differ only by version collide on one key as well. Every record's terms are pooled first
     * and ranked once, rather than letting whichever came last win regardless of severity.
     *
     * Args:
     *  transcriptConsequences (array): {transcriptId, terms} objects. Records with no id or no
     *      terms are skipped.
     */
    const termsByTranscriptId = {}
    for (const {transcriptId, terms} of transcriptConsequences) {
        if (!transcriptId || !terms || !terms.length) continue
        const key = transcriptIdKey(transcriptId)
        termsByTranscriptId[key] = (termsByTranscriptId[key] || []).concat(terms)
    }
    const consequencesByTranscriptId = {}
    for (const key of Object.keys(termsByTranscriptId)) {
        consequencesByTranscriptId[key] = mostSevereConsequence(termsByTranscriptId[key])
    }
    return consequencesByTranscriptId
}

const geneBeVariantToString = (geneBeVariant) => {
    /* Format one variant object from a GeneBe response as "{chrom}-{pos}-{ref}-{alt}". */
    return `${String(geneBeVariant.chr).replace(/^chr/i, "").toUpperCase()}-${geneBeVariant.pos}`
        + `-${String(geneBeVariant.ref).toUpperCase()}-${String(geneBeVariant.alt).toUpperCase()}`
}

const annotateVariantWithGeneBe = async (queryVariant, genomeVersion, variant, expectedVariant = null) => {
    /* Look up a variant's consequences with the GeneBe variant-relaxed API. Returns null if GeneBe is
     * unreachable or has nothing for the variant, so the caller can fall back to Ensembl.
     *
     * Args:
     *  queryVariant (string): what to ask GeneBe about. variant-relaxed takes HGVS, rs ids, SPDI and
     *      protein changes as well as "{chrom}-{pos}-{ref}-{alt}", so hg38 callers pass the user's
     *      input straight through and let this one call both resolve and annotate it.
     *  genomeVersion (string): "37" or "38"
     *  variant (string): the user's input text, used in the reference-allele note
     *  expectedVariant (string): "{chrom}-{pos}-{ref}-{alt}" the answer has to describe, or null when
     *      the caller has no coordinates of its own and is relying on GeneBe to resolve them
     *
     * Return:
     *  object: {variant, consequence, consequencesByTranscriptId}, or {refAlleleError}, or null.
     *      null covers both GeneBe having nothing usable for the variant and the call itself
     *      failing, so callers can treat one return value as "no answer". The returned variant is
     *      in hg38 coordinates whatever genome version was asked for.
     */
    // GeneBe names the genome builds hg19 and hg38, where this page numbers them 37 and 38
    const geneBeGenome = genomeVersion == '37' ? "hg19" : "hg38"
    let annotationResponse
    try {
        annotationResponse = await makeRequest(
            `${GENEBE_API_PREFIX}/variant-relaxed?variant=${encodeURIComponent(queryVariant)}`
                + `&genome=${geneBeGenome}`,
            GENEBE_TIMEOUT_MS)
    } catch (e) {
        console.warn("GeneBe API call failed:", e)
        return null
    }
    const annotation = annotationResponse.ok && annotationResponse.variants ? annotationResponse.variants[0] : null
    if (!annotation) {
        console.warn("GeneBe variant-relaxed API returned no annotation for", queryVariant, annotationResponse)
        return null
    }

    const returnedRef = annotation.ref ? String(annotation.ref).toUpperCase() : null
    const returnedAlt = annotation.alt ? String(annotation.alt).toUpperCase() : null
    if (!returnedRef || !returnedAlt || !annotation.chr || !annotation.pos) {
        console.warn("GeneBe variant-relaxed API returned an incomplete variant for", queryVariant, annotation)
        return null
    }

    // GeneBe keys its consequence records by 'feature' (both Ensembl ENST ids and RefSeq NM ids)
    const consequencesByTranscriptId = mostSevereConsequenceByTranscriptId(
        (annotation.consequences || []).map(
            (c) => ({'transcriptId': c.feature, 'terms': c.consequences})))

    // GeneBe substitutes the true reference allele when the one it was given doesn't match, rather
    // than rejecting the variant, and says so in a 'warning' field naming the base it used instead.
    if (annotation.warning) {
        const correctRef = annotation.warning.match(/reference sequence \(([ACGTN]+)\)/i)
        // GeneBe's hg38 reference is N-masked across the chrY pseudoautosomal regions, so every
        // variant in chrY:10,001-2,781,479 is reported as a REF mismatch against "N". That says
        // nothing about the user's allele, so treat it as GeneBe having no answer for the position.
        if (correctRef && /^N+$/i.test(correctRef[1])) {
            console.warn("GeneBe has no reference sequence at this position, falling back:", queryVariant)
            return null
        }
        return {
            'refAlleleError': `${variant} has an unexpected reference allele. `
                + (correctRef
                    ? `The ${geneBeGenome} reference allele should be ${correctRef[1].toUpperCase()}`
                    : `It does not match the ${geneBeGenome} reference genome`),
        }
    }

    // The warning field covers hg38 only. An hg19 query is answered by lifting to GRCh38, where the
    // reference base at that position may be a different one with nothing said about it, so when the
    // caller brought its own coordinates, check the alleles echoed back as well. Positions can't be
    // compared for hg19, since the echoed one is the lifted GRCh38 position. GeneBe also left-aligns
    // indels, which re-writes the alleles without changing the variant, so the comparison is on what
    // the variant changes rather than on the allele strings themselves.
    //
    // hg38 is left out: its warning field is set whenever the REF didn't match, so a warning-free
    // answer to coordinates we supplied IS this variant, just possibly left-aligned.
    if (expectedVariant && genomeVersion != '38') {
        const askedFor = expectedVariant.split("-")
        if (alleleChange(returnedRef, returnedAlt) != alleleChange(askedFor[2], askedFor[3])) {
            // Same position and same REF length means GeneBe is naming the reference allele this
            // variant should have had, which is worth telling the user.
            if (String(annotation.pos) == askedFor[1] && returnedAlt == askedFor[3]
                && returnedRef.length == askedFor[2].length) {
                return {
                    'refAlleleError': `${variant} has an unexpected reference allele. `
                        + `The ${geneBeGenome} reference allele should be ${returnedRef}`,
                }
            }
            console.warn("GeneBe annotated a different variant than the one asked about:",
                expectedVariant, `${annotation.chr}-${annotation.pos}-${returnedRef}-${returnedAlt}`)
            return null
        }
    }

    return {
        'variant': geneBeVariantToString(annotation),
        // GeneBe joins the variant-level terms with commas, where Ensembl's most_severe_consequence
        // is a single term. Reduce it to one term so both paths log and check the same thing.
        'consequence': annotation.effect ? mostSevereConsequence(annotation.effect.split(",")) : null,
        'consequencesByTranscriptId': consequencesByTranscriptId,
    }
}

const resolveVariantWithGeneBe = async (variant) => {
    /* Resolve the given variant to "{chrom}-{pos}-{ref}-{alt}" and look up its consequences using the
     * GeneBe API. hg38 only: variant-relaxed answers with hg38 coordinates whatever genome version is
     * requested. Returns null if GeneBe is unreachable or can't resolve the variant.
     *
     * Args:
     *  variant (string): user input text, which is always HGVS notation or a dbSNP id here.
     */
    // No expectedVariant: hg38 answers are checked by GeneBe's own 'warning' field instead of by
    // comparing alleles, for the reason set out in annotateVariantWithGeneBe's comparison.
    const result = await annotateVariantWithGeneBe(variant.trim(), "38", variant)

    // A dbSNP id names a position, not an allele, and GeneBe answers a multi-allelic one with a
    // single ALT of its choosing. Scoring one allele the user never picked is only safe if the page
    // says which one it used, so name it. hg19 doesn't need this: Ensembl rejects rs ids.
    if (result && result.variant && RS_ID_RE.test(variant.trim())) {
        result.warnings = [
            `${variant.trim()} was resolved to ${result.variant}. A dbSNP ID can cover more than `
            + `one alternate allele, so if you meant a different one, search for it as `
            + `chrom-pos-ref-alt.`,
        ]
    }
    return result
}

const resolveVariantWithVariantValidator = async (variant, genomeVersion) => {
    /* Fallback coordinate resolver, used only when the Ensembl API is unreachable.
     * Converts an HGVS variant to "{chrom}-{pos}-{ref}-{alt}" via the public VariantValidator REST
     * API (no API key required). Returns that string on success, or null if VariantValidator is
     * unreachable or can't resolve the variant. Does NOT provide a VEP consequence. */
    const build = genomeVersion == '37' ? 'GRCh37' : 'GRCh38'
    const buildKey = genomeVersion == '37' ? 'grch37' : 'grch38'
    try {
        const response = await makeRequest(
            // Use the 'select' (MANE/RefSeq-select) transcript set rather than 'all':
            // VariantValidator has deprecated select_transcripts='all'/'raw' for genomic (g.) HGVS
            // input, which returns a 404 "Not Found" instead of coordinates.
            `https://rest.variantvalidator.org/VariantValidator/variantvalidator/${build}/${encodeURIComponent(variant.trim())}/select`,
            VARIANTVALIDATOR_TIMEOUT_MS)
        // The response is keyed by validated variant description(s), alongside "flag" and
        // "metadata" keys; the genomic position lives under primary_assembly_loci[buildKey].vcf.
        for (const key of Object.keys(response)) {
            if (key === 'flag' || key === 'metadata') continue
            const loci = response[key] && response[key].primary_assembly_loci
            const vcf = loci && loci[buildKey] && loci[buildKey].vcf
            if (vcf && vcf.chr && vcf.pos && vcf.ref && vcf.alt) {
                return `${String(vcf.chr).replace(/^chr/i, '')}-${vcf.pos}-${vcf.ref}-${vcf.alt}`
            }
        }
        console.warn("VariantValidator returned no genomic coordinates for", variant, response)
        return null
    } catch (e) {
        console.warn("VariantValidator fallback failed:", e)
        return null
    }
}

const ensemblApiPrefix = (genomeVersion) => (
    `https://${genomeVersion == '37' ? 'grch37.' : ''}rest.ensembl.org/vep/human/hgvs/`
)

const genomicHgvs = (chrom, pos, ref, alt) => {
    /* Build the genomic (g.) HGVS string the Ensembl VEP endpoint needs for parsed coordinates. */
    if (ref.length == 1 && alt.length == 1) {
        return `${chrom}:g.${pos}${ref}>${alt}`  // SNV
    }
    if (ref.length == 1 && alt.startsWith(ref)) {
        // Insertion: the ALT repeats the REF base and then adds to it, which HGVS writes as an
        // ins between that base and the next. Written as "A>AGAGAG" instead, Ensembl parses it
        // as a different edit entirely.
        return `${chrom}:g.${pos}_${pos + 1}ins${alt.slice(1)}`
    }
    if (alt.length == 1 && ref.startsWith(alt)) {
        return `${chrom}:g.${pos + 1}_${pos + ref.length - 1}del${ref.slice(1)}`  // deletion
    }
    // Anything else -- an MNP, or an indel whose first base changes as well -- is a delins over
    // the whole REF span.
    return ref.length == 1
        ? `${chrom}:g.${pos}delins${alt}`
        : `${chrom}:g.${pos}_${pos + ref.length - 1}delins${alt}`
}

const annotateVariantWithEnsembl = async (chrom, pos, ref, alt, genomeVersion) => {
    /* Look up the consequences of coordinates this page already parsed, using the Ensembl VEP API.
     * The counterpart to annotateVariantWithGeneBe, so that the two can be raced against each other
     * on hg38. The answer is discarded unless the variant Ensembl reports back is the one it was
     * asked about, since Ensembl mis-parses the REF>REF+ALT insertion shorthand.
     *
     * Return:
     *  object: {variant, consequence, consequencesByTranscriptId}, or null when Ensembl has no
     *      usable answer, including when the call itself fails.
     */
    const hgvs = genomicHgvs(chrom, pos, ref, alt)
    if (!hgvs) {
        return null
    }
    const expectedVariant = `${chrom}-${pos}-${ref}-${alt}`
    let responseJson
    try {
        responseJson = await makeRequest(
            `${ensemblApiPrefix(genomeVersion)}${hgvs}?content-type=application/json&vcf_string=1`,
            ENSEMBL_TIMEOUT_MS)
    } catch (e) {
        console.warn("Ensembl API call failed:", e)
        return null
    }
    if (!responseJson.ok || responseJson.error || !responseJson[0]) {
        console.warn("Ensembl API returned no annotation for", hgvs, responseJson)
        return null
    }
    const annotation = responseJson[0]
    if (String(annotation.vcf_string).toUpperCase() != expectedVariant.toUpperCase()) {
        console.warn("Ensembl annotated a different variant than the one asked about:",
            expectedVariant, annotation.vcf_string)
        return null
    }
    return {
        'variant': expectedVariant,
        'consequence': annotation.most_severe_consequence || null,
        // VEP keys its consequence records by transcript_id
        'consequencesByTranscriptId': mostSevereConsequenceByTranscriptId(
            (annotation.transcript_consequences || []).map(
                (c) => ({'transcriptId': c.transcript_id, 'terms': c.consequence_terms}))),
    }
}

const firstUsableAnswer = async (attempts) => {
    /* Return the first of several in-flight lookups to come back with something usable.
     * Promise.any counts only a rejection as a loss, but these resolvers answer null when they
     * have nothing to say, so each one is wrapped to reject on null. Every attempt is started
     * before this is called, so the losers keep running and are simply ignored. */
    try {
        return await Promise.any(attempts.map(async (attempt) => {
            const result = await attempt
            if (!result) {
                throw Error("no usable answer")
            }
            return result
        }))
    } catch (e) {
        return null  // AggregateError: every attempt failed or had nothing
    }
}

const consequencesFrom = async (annotationPromise, fallbackPromise = null, genomeVersion = null) => {
    /* Reduce a consequence lookup to the fields the results tables and lookups use.
     *
     * GeneBe is always the first argument. Its answer is preferred wherever both are available,
     * because it covers the Gencode-lifted transcript ids the score tables carry far better than
     * VEP does. The fallback is read only when GeneBe found no per-transcript consequences at all.
     *
     * Return:
     *  object: {consequence, consequencesByTranscriptId, normalizedVariant}, all null when neither
     *      source had an answer. Never rejects.
     */
    const annotation = await annotationPromise
    if (annotation && annotation.refAlleleError) {
        // Not thrown: by the time this answers, the caller has already sent the scoring requests
        // the error would have saved, and the backends report a wrong REF just as specifically.
        console.warn("Consequence lookup reported a wrong reference allele:", annotation.refAlleleError)
    }
    // Counted as "found nothing" when the map is empty as well as when it is absent:
    // mostSevereConsequenceByTranscriptId returns {} if no record carried both an id and terms,
    // and {} is truthy, so testing the object itself would never reach the fallback.
    const usable = annotation && Object.keys(annotation.consequencesByTranscriptId || {}).length
        ? annotation
        : await fallbackPromise
    return {
        'consequence': usable ? usable.consequence || null : null,
        'consequencesByTranscriptId': usable ? usable.consequencesByTranscriptId || null : null,
        // The resolver's own spelling of the variant. GeneBe left-aligns indels, and that is the
        // spelling gnomAD, myvariant.info and the precomputed score tables index, where the
        // services score the trimmed spelling. Withheld for hg19, where GeneBe answers with hg38
        // coordinates.
        'normalizedVariant': genomeVersion == '38' && usable ? usable.variant || null : null,
    }
}

const annotateParsedVariant = (chrom, pos, ref, alt, genomeVersion, userInputVariant) => {
    /* Look up the consequences of coordinates already in "{chrom}-{pos}-{ref}-{alt}" form.
     *
     * On hg38 Ensembl is asked at the same time as GeneBe rather than after it, so its answer is
     * already in hand if GeneBe has none, and a GeneBe outage costs no extra round trip. hg19 asks
     * GeneBe alone, since the GRCh37 VEP transcript set barely overlaps the ids the score tables
     * carry.
     *
     * Return:
     *  Promise: resolves to {consequence, consequencesByTranscriptId}, both null when no source
     *      could annotate the variant. Never rejects.
     */
    const parsedVariant = `${chrom}-${pos}-${ref}-${alt}`
    return consequencesFrom(
        annotateVariantWithGeneBe(parsedVariant, genomeVersion, userInputVariant, parsedVariant),
        genomeVersion == '38' ? annotateVariantWithEnsembl(chrom, pos, ref, alt, genomeVersion) : null,
        genomeVersion)
}

const ensemblRejection = (message) => {
    /* An error meaning Ensembl answered and would not resolve this variant, as opposed to being
     * unreachable. A variant Ensembl rejected on its merits (a REF allele the reference genome
     * doesn't have, notation it cannot parse) gets the same answer from anywhere, and the message it
     * came with is the one worth showing. */
    const error = Error(message)
    error.ensemblRejected = true
    return error
}

const resolveHgvsWithEnsembl = async (variant, genomeVersion) => {
    /* Convert HGVS notation to "{chrom}-{pos}-{ref}-{alt}" with the Ensembl VEP API.
     * Throws rather than answering null, so the hg19 path can tell the user exactly why the
     * conversion failed. The hg38 race catches that and treats it as one contestant losing. */
    const responseJson = await makeRequest(
        `${ensemblApiPrefix(genomeVersion)}${variant.trim()}?content-type=application/json&vcf_string=1`,
        ENSEMBL_TIMEOUT_MS)
    console.log("Ensembl API response:", responseJson)

    if (!responseJson.ok || responseJson.error) {
        let errorText = `${responseJson.error}`
        const refAlleleErrorMatch = errorText.match(
            new RegExp("[(]([ACGTRYSWKMBDHVN]+)[)] does not match reference allele given by HGVS notation"))
        if (refAlleleErrorMatch) {
            errorText = `${variant} has an unexpected reference allele. `
                + `The ${genomeDisplayName(genomeVersion)} reference allele should be ${refAlleleErrorMatch[1]}`
        }
        throw ensemblRejection(errorText)
    }
    if (!responseJson[0] || !responseJson[0].vcf_string) {
        throw ensemblRejection(`Unexpected response: ${JSON.stringify(responseJson)}`)
    }
    const matchedRegExp = String(responseJson[0].vcf_string).match(VARIANT_RE)
    if (!matchedRegExp) {
        // Deliberately not an ensemblRejection: Ensembl did resolve the variant, and what failed is
        // VARIANT_RE, which only accepts the primary contigs and plain ACGT alleles this page can
        // score -- so the hg19 path must stay free to try VariantValidator.
        throw Error(`Unexpected response: ${JSON.stringify(responseJson)}`)
    }
    return {
        'variant': `${matchedRegExp[2].toUpperCase()}-${parseInt(matchedRegExp[3])}`
            + `-${matchedRegExp[4].toUpperCase()}-${matchedRegExp[5].toUpperCase()}`,
        'consequence': responseJson[0].most_severe_consequence,
        // VEP keys its consequence records by transcript_id
        'consequencesByTranscriptId': mostSevereConsequenceByTranscriptId(
            (responseJson[0].transcript_consequences || []).map(
                (c) => ({'transcriptId': c.transcript_id, 'terms': c.consequence_terms}))),
    }
}

const resolveHgvsWithVariantValidator = async (variant, genomeVersion, userInputVariant, onProgress, fallbackReason) => {
    /* Last-resort HGVS conversion, for when the APIs that normally convert it could not.
     *
     * Return:
     *  object: a normalizeVariant result with usedFallback set, or null when VariantValidator
     *      couldn't resolve the variant either
     */
    onProgress("Converting HGVS notation to chrom-pos-ref-alt using VariantValidator...")
    const vvVariant = await resolveVariantWithVariantValidator(variant, genomeVersion)
    if (!vvVariant) {
        return null
    }
    console.warn(`Using VariantValidator as the fallback resolver: ${vvVariant}`)
    // Worth asking GeneBe now, on either build: it was handed the raw HGVS text earlier and
    // couldn't resolve it, so unlike the parsed-coordinate paths it has never seen these
    // coordinates.
    const [vvChrom, vvPos, vvRef, vvAlt] = vvVariant.split("-")
    return {
        'variant': vvVariant,
        'consequencesPromise': annotateParsedVariant(
            vvChrom, parseInt(vvPos), vvRef, vvAlt, genomeVersion, userInputVariant),
        'usedFallback': true,
        'fallbackReason': fallbackReason,
    }
}

const normalizeVariant = async (variant, genomeVersion, onProgress = () => {}) => {
    /* Convert the given variant to a standardized "{chrom}-{pos}-{ref}-{alt}" string and start
     * looking up its consequences.
     *
     * The coordinates come back resolved, but the consequences come back still in flight, so the
     * caller can send the SpliceAI and Pangolin requests the moment it has coordinates rather than
     * waiting on an annotation none of them need.
     *
     * Input this page's own regexp can parse is already in the target form and returns without
     * waiting on anything -- an Ensembl outage or a wrong-REF verdict from it can no longer stop a
     * search on coordinates the page parsed itself. Only HGVS notation has to be resolved. hg38 asks
     * GeneBe and Ensembl at once and takes whichever answers first, so a search survives either one
     * being down. hg19 asks Ensembl alone, because GeneBe parses genomic HGVS as hg38 whatever
     * genome is requested and then lifts over. VariantValidator is the fallback on both builds.
     *
     * The REF allele is checked by the SpliceAI and Pangolin backends themselves (check_ref_allele
     * in server.py), against the reference genome and on both builds.
     *
     * Args:
     *  variant (string): user input text
     *  genomeVersion (string): "37" or "38"
     *  onProgress (function): called with a message naming the resolver about to be waited on
     *
     * Return:
     *  object: {variant, consequencesPromise, warnings, usedFallback, fallbackReason}, where
     *      consequencesPromise resolves to {consequence, consequencesByTranscriptId,
     *      normalizedVariant} and never rejects
     */

    // `variant` is the user's text throughout; the resolvers are handed it as-is
    const userInputVariant = variant
    const matchedRegExp = variant.match(VARIANT_RE)

    if (matchedRegExp) {
        // The page parsed the coordinates itself, so there is nothing to resolve and nothing to
        // wait for. The consequences are left running for the caller to await alongside the
        // scoring requests instead of ahead of them. What was typed is sent as-is: the backends
        // don't left-align either, they only trim the bases REF and ALT share.
        const chrom = matchedRegExp[2].toUpperCase()
        const pos = parseInt(matchedRegExp[3].replace(/,/g, ""))
        const ref = matchedRegExp[4].toUpperCase()
        const alt = matchedRegExp[5].toUpperCase()
        return {
            'variant': `${chrom}-${pos}-${ref}-${alt}`,
            'consequencesPromise': annotateParsedVariant(
                chrom, pos, ref, alt, genomeVersion, userInputVariant),
        }
    }

    // Everything below is HGVS notation, the only input that still has to be resolved.
    if (genomeVersion == '38') {
        onProgress("Converting HGVS notation to chrom-pos-ref-alt using the GeneBe and Ensembl APIs...")
        // resolveHgvsWithEnsembl throws to report why it failed, which is one contestant losing
        // rather than the search failing, so its rejection is turned into "no answer" here.
        // A rejection Ensembl made on the variant's merits is kept aside, though: if nothing
        // else can resolve the input either, it is the most specific thing anyone said about it.
        let ensemblRejectionError = null
        const resolved = await firstUsableAnswer([
            // Tagged so the consequences below can tell whether GeneBe's own answer is already
            // in hand, or whether it still has to be asked about the coordinates Ensembl chose.
            resolveVariantWithGeneBe(variant).then((r) => r && {...r, 'fromGeneBe': true}),
            resolveHgvsWithEnsembl(variant, genomeVersion).catch((e) => {
                console.warn("Ensembl API couldn't convert the HGVS notation:", e)
                if (e.ensemblRejected) {
                    ensemblRejectionError = e
                }
                return null
            }),
        ])
        if (resolved && resolved.refAlleleError) {
            // Stop here rather than spending scoring requests on a variant that cannot score.
            throw Error(resolved.refAlleleError)
        }
        if (resolved) {
            console.log("hg38 HGVS resolved to:", resolved)
            return {
                'variant': resolved.variant,
                // Set when the input left the allele open, eg. a dbSNP id that covers several
                'warnings': resolved.warnings,
                // GeneBe's consequences are preferred everywhere, so when Ensembl won the race
                // GeneBe is asked again, about the coordinates Ensembl settled on. Ensembl's own
                // answer is the fallback, already in hand.
                'consequencesPromise': resolved.fromGeneBe
                    ? Promise.resolve({
                        'consequence': resolved.consequence,
                        'consequencesByTranscriptId': resolved.consequencesByTranscriptId,
                        'normalizedVariant': resolved.variant,
                    })
                    : consequencesFrom(
                        annotateVariantWithGeneBe(
                            resolved.variant, genomeVersion, userInputVariant, resolved.variant),
                        resolved,
                        genomeVersion),
            }
        }
        const fallback = await resolveHgvsWithVariantValidator(
            variant, genomeVersion, userInputVariant, onProgress,
            "Neither the GeneBe nor the Ensembl API could convert this HGVS notation, so it was "
                + "converted to genomic coordinates via VariantValidator")
        if (fallback) {
            return fallback
        }
        // VariantValidator is still tried above even when Ensembl rejected the input, since it
        // parses some notation Ensembl doesn't. But once it has failed too, Ensembl's verdict is
        // what to report: for a wrong REF allele it names the base the genome actually has.
        if (ensemblRejectionError) {
            throw ensemblRejectionError
        }
        throw Error(`Neither the GeneBe nor the Ensembl API could convert ${variant} to genomic `
            + `coordinates. ${GENOMIC_COORDINATE_HINT}`)
    }

    // hg19: Ensembl resolves the coordinates on its own, and its error text is what the user sees
    // when it can't, so this one is awaited rather than raced.
    onProgress("Converting HGVS notation to chrom-pos-ref-alt using the Ensembl API...")
    let resolved
    try {
        resolved = await resolveHgvsWithEnsembl(variant, genomeVersion)
    } catch (e) {
        console.error(e)
        if (e.ensemblRejected) {
            // Ensembl answered and rejected the variant, so VariantValidator would only spend a
            // round trip to reach the same conclusion.
            throw e
        }
        const errorMessage = e.message || e.toString()
        const fallback = await resolveHgvsWithVariantValidator(
            variant, genomeVersion, userInputVariant, onProgress,
            errorMessage.includes('timed out')
                ? 'Ensembl API timed out; converted HGVS to genomic coordinates via VariantValidator'
                : 'Ensembl API unavailable; converted HGVS to genomic coordinates via VariantValidator')
        if (fallback) {
            return fallback
        }
        if (errorMessage.includes('timed out')) {
            throw Error(`Ensembl API timed out. ${GENOMIC_COORDINATE_HINT}`)
        }
        throw Error(`Ensembl API call failed: ${errorMessage}. ${GENOMIC_COORDINATE_HINT}`)
    }

    // The GRCh37 VEP endpoint annotates against an older Ensembl transcript set that largely
    // doesn't line up with the Gencode-lifted transcript ids the SpliceAI and Pangolin results
    // carry for hg19, so most rows -- often including the MANE Select row -- would have no
    // consequence to show. GeneBe covers those ids, so prefer it and keep VEP's as the fallback.
    return {
        'variant': resolved.variant,
        'consequencesPromise': consequencesFrom(
            annotateVariantWithGeneBe(resolved.variant, genomeVersion, userInputVariant, resolved.variant),
            resolved,
            genomeVersion),
    }
}

const makeRequest = (url, timeoutMs = null) => {
    const method = "GET"
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        let timeoutId = null

        if (timeoutMs) {
            timeoutId = setTimeout(() => {
                xhr.abort()
                reject(new Error(`Request timed out after ${timeoutMs / 1000} seconds`))
            }, timeoutMs)
        }

        xhr.open(method, url)
        xhr.addEventListener("load", () => {
            if (timeoutId) clearTimeout(timeoutId)
            console.log("GET", url, xhr.status, xhr.statusText)
            let response = {}
            try {
                response = JSON.parse(xhr.response)
            } catch(e) {
                console.error("Unable to parse response", xhr.response)
                reject(`Unexpected error: ${url}`)
                return
            }

            response.ok = xhr.status >= 200 && xhr.status < 300
            resolve(response)
        })
        xhr.addEventListener("error", () => {
            if (timeoutId) clearTimeout(timeoutId)
            if (xhr.status == 0) {
                reject("Unable to reach server")
            } else {
                reject(`${xhr.status}  ${xhr.statusText}`)
            }
        })
        xhr.addEventListener("abort", () => {
            if (timeoutId) clearTimeout(timeoutId)
            // reject is already called by the timeout handler
        })
        //console.log('Sending request', method, url)
        xhr.send()
    })
}

const considerInsertedBases = (score, position, ref, alt, scoresForInsertedBases) => {
    //check if the variant is an insertion and if so, return the number of inserted bases
    return roundScore(score) >= 0.01 && position == 0 && ref.length == 1 && alt.length > 1 && scoresForInsertedBases && scoresForInsertedBases.length > 0
}

// The API echoes back whichever form the user typed, so the chromosome arrives with or without the
// prefix depending on how the variant was entered.
const withChrPrefix = (chrom) => String(chrom).startsWith("chr") ? String(chrom) : `chr${chrom}`

// Group a genomic coordinate or an offset into thousands, so 7669671 reads as 7,669,671. Pinned to
// en-US rather than the viewer's locale: the separator would otherwise be a period in much of
// Europe, which in a table of genomic coordinates reads as a decimal point. Display only -- the CSV
// writes these fields unformatted, since a comma inside a value would split the column.
const withThousandsSeparators = (value) => Number(value).toLocaleString("en-US")

/* The locus cell shared by the per-position table and the inserted-bases table. Both alleles are
   truncated the same way the main results table does it: the cell is nowrap and sits ahead of ten
   score columns in a fixed-width modal, so a long allele would push those columns out of view. The
   truncated allele is still recoverable -- the per-position modal's download button writes both
   alleles in full to its CSV. */
const buildLocusText = (chrom, pos, ref, alt, isVariant) =>
    `${withChrPrefix(chrom)}:${withThousandsSeparators(pos)} ${truncateAllele(ref)}`
        + (isVariant ? ` > ${truncateAllele(alt)}` : "")

const annotateGenomicScoreRow = (row, context, {variantAlt, variantNote = ""}) => {
    /* Describe one score row that has a real genomic coordinate. Both score tables annotate their
       genomic rows through here, so the locus, offset and notes cells cannot drift apart.
       positionDelta is kept as a number alongside the formatted text because perPositionRowsToCsv
       writes the raw value into the download.
       variantAlt is the ALT to show on the variant row, and the caller has to say which one it
       means, because the two tables read different fields for it. */
    const pos = parseInt(row.pos)
    const isVariant = pos == context.variantPos
    return {
        ...row,
        pos: pos,
        isVariant: isVariant,
        locusText: buildLocusText(context.chrom, pos, row.ref, variantAlt, isVariant),
        /* Signed genomic offset, the same quantity the main results table's position column shows,
           so the tables can be read against each other row by row. */
        positionDelta: pos - context.variantPos,
        positionDeltaText: `${withThousandsSeparators(pos - context.variantPos)} bp`,
        note: [
            isVariant ? "variant" : "",
            isVariant ? variantNote : "",
            getExonNoteForPosition(pos, context.scores),
        ].filter(Boolean).join("; "),
    }
}

const buildInsertedBaseRows = (scoresForInsertedBases, context) => {
    /* Annotate the inserted-bases rows the way buildPerPositionRows annotates the per-position ones,
       so both tables can go through renderScoreTableFromRows.
       The flanking genomic bases carry a real coordinate and are described exactly as the
       per-position table describes them. The inserted bases have no coordinate at all -- the API
       reports their pos as "+N" -- so they get their +N label as the locus, no position delta, and a
       note saying which inserted base they are. */
    const insertedBaseCount = scoresForInsertedBases.filter((row) => `${row.pos}`.startsWith("+")).length
    let insertedBaseNumber = 0
    return scoresForInsertedBases.map((row) => {
        if (`${row.pos}`.startsWith("+")) {
            insertedBaseNumber++
            return {
                ...row,
                // No genomic position, which is also what makes masking come out right for these
                // rows: an inserted base is by definition not an annotated splice site, so a gain
                // here survives masking and a loss here is suppressed.
                pos: null,
                isVariant: false,
                locusText: `${row.pos} (> ${row.alt})`,
                positionDeltaText: "—",
                note: `inserted base ${insertedBaseNumber} of ${insertedBaseCount}`,
            }
        }
        // context.alt, not row.alt: at the variant's own position these rows carry the unchanged
        // reference base, since the insertion sits between two genomic coordinates.
        return annotateGenomicScoreRow(row, context, {variantAlt: context.alt})
    })
}

const generateTableOfScoresForInsertedBases = (modalId, score, position, ref, alt, scoresForInsertedBases, context) => {
    //warn about insertion variants that are predicted to cause a donor or acceptor gain somewhere within the inserted sequence.
    if (!considerInsertedBases(score, position, ref, alt, scoresForInsertedBases)) {
        return ""
    }

    const table = (
        `<div>
           Detailed SpliceAI predictions for bases within the inserted sequence as well as +/-5bp around the insertion position: <br>
           ${renderScoreTableFromRows(buildInsertedBaseRows(scoresForInsertedBases, context), context)}
        </div>`
    ).replace(/\n/g, "")

    const modal = `<div id='modal-with-table${modalId}' class='ui modal'><i class='close icon'></i><div class='scrolling content'>${table}</div></div>`
    const modalIcon = `<i id='table-icon${modalId}' style='margin-left:10px;color:#000080;cursor:pointer' class='table icon'></i>`
    return `${modalIcon}${modal}`

}

const updatePositionAccountingForInsertedBases = (scoreKey, score, position, ref, alt, scoresForInsertedBases) => {
    if (!considerInsertedBases(score, position, ref, alt, scoresForInsertedBases)) {
        return `${position} bp`
    }

    let altKey, refKey
    if (scoreKey == 'DS_AG') {
        altKey = 'AA'
        refKey = 'RA'
    } else if (scoreKey == 'DS_DG') {
        altKey = 'AD'
        refKey = 'RD'
    } else {
        return `${position} bp`
    }

    /* Find the offset within the inserted sequence that accounts for the gain the model summarized
       onto offset 0.
       Two things the rows require. First, scoresForInsertedBases covers the flanking genomic bases
       as well as the inserted ones, and only the inserted ones can explain an offset the model had
       nowhere else to put: the API marks those by reporting pos as "+N" instead of a coordinate, so
       every row whose pos is a real coordinate is skipped. Second, the gain is ALT - REF, not ALT
       alone, the same argmax(alt - ref) SpliceAI itself uses -- an annotated site beside the
       insertion scores near 1.0 in both REF and ALT and would otherwise win the argmax while being
       no gain at all. */
    let maxDelta = 0
    let maxDeltaPosition = 0
    for (const scoreObj of scoresForInsertedBases) {
        if (!`${scoreObj.pos}`.startsWith("+")) {
            continue
        }
        const delta = parseFloat(scoreObj[altKey]) - parseFloat(scoreObj[refKey])
        if (delta > maxDelta) {
            maxDelta = delta
            maxDeltaPosition = parseInt(scoreObj.pos)
        }
    }

    // Nothing inside the inserted sequence accounts for the gain, so the model's own offset is the
    // best available answer and is left alone.
    if (maxDeltaPosition == 0) {
        return `${position} bp`
    }

    return `+${maxDeltaPosition} bp position within the inserted sequence`
}

// The per-position score table: one modal per transcript, opened from the table icon in that
// transcript's cell. The rows come from the /scores endpoint rather than the main response, so
// opening a table costs one small request instead of enlarging every search.

// Pangolin reports two pairs per position: the REF and ALT splice-site probabilities behind its
// splice-loss delta score, and the pair behind its splice-gain delta score. Both are shown because
// they are the numbers the delta scores are computed from and the ones the IGV track draws.
const PER_POSITION_COLUMNS = {
    spliceai: [["REF acceptor score", "RA"], ["REF donor score", "RD"], ["ALT acceptor score", "AA"], ["ALT donor score", "AD"]],
    pangolin: [["REF score (loss)", "SL_REF"], ["ALT score (loss)", "SL_ALT"], ["REF score (gain)", "SG_REF"], ["ALT score (gain)", "SG_ALT"]],
}

/* A delta is reported only when it is at least 0.01; anything smaller, including every negative
   value, is reported as 0. A negative delta means the change went the other way, and that direction
   already has its own column -- a negative Acceptor Loss is an Acceptor Gain.
   Each operand is rounded to the 2 decimals its own column displays before the subtraction, so a
   delta always equals the subtraction a reader can do on the two cells beside it. */
const PER_POSITION_DELTA_MIN = 0.01
const perPositionDelta = (a, b) => {
    const delta = roundScore(roundScore(a) - roundScore(b))
    return delta < PER_POSITION_DELTA_MIN ? 0 : delta
}

/* Delta columns, derived here from the REF and ALT columns above rather than sent by the API. Every
   one is written so that a real effect comes out POSITIVE: a loss means the site got weaker, so
   ref - alt, and a gain means it got stronger, so alt - ref. This matches SpliceAI, which takes its
   loss index from argmax(ref - alt) and its gain index from argmax(alt - ref).
   Pangolin is the one to be careful with: its own loss score is signed and negative for a real
   loss, so copying that expression here would produce a negative number for exactly the positions
   that matter. The loss delta is therefore ref - alt like every other loss column.
   Each column is [label, kind, compute]. The kind is what masking keys off. */
const PER_POSITION_DELTA_COLUMNS = {
    spliceai: [
        ["Δ score acceptor loss", "loss", (r) => perPositionDelta(r.RA, r.AA)],
        ["Δ score donor loss", "loss", (r) => perPositionDelta(r.RD, r.AD)],
        ["Δ score acceptor gain", "gain", (r) => perPositionDelta(r.AA, r.RA)],
        ["Δ score donor gain", "gain", (r) => perPositionDelta(r.AD, r.RD)],
    ],
    pangolin: [
        ["Δ score loss", "loss", (r) => perPositionDelta(r.SL_REF, r.SL_ALT)],
        ["Δ score gain", "gain", (r) => perPositionDelta(r.SG_ALT, r.SG_REF)],
    ],
}

// Keeps "Δ score" on one line while the rest of a header may still wrap. The labels are constants
// defined above, never user input, so injecting markup here introduces nothing to escape.
const headerLabelHtml = (label) => label.replace("Δ score", `<span style="white-space:nowrap">Δ score</span>`)

/* Styling for the REF and ALT columns. Those are the model's raw probabilities, where a high value
   is simply what an annotated splice site looks like and means nothing on its own, so shading them
   competes for attention with the delta columns. Only the near-zero grey is kept. */
const getRawScoreStyle = (score) => Math.abs(roundScore(score)) < 0.01 ? `style='color:#BBBBBB;'` : ""

// Keyed by the id embedded in each transcript's table icon, and populated while the results table is
// built so the click handler has the transcript's exon structure and query params.
const perPositionTableContext = {}

const getExonNoteForPosition = (pos, scores) => {
    /* Return "exon N acceptor" or "exon N donor" if pos is an annotated splice site of this
       transcript, otherwise "". Exons are numbered in transcript direction, and which end of an exon
       is the acceptor depends on the strand. The transcript's outermost boundaries are the
       transcription start and end sites rather than splice sites, so they get no label. */
    const exonStarts = scores['EXON_STARTS'] || []
    const exonEnds = scores['EXON_ENDS'] || []
    const isMinusStrand = scores['t_strand'] == "-"
    for (let i = 0; i < exonStarts.length; i++) {
        const exonNumber = isMinusStrand ? exonStarts.length - i : i + 1
        if (pos == exonStarts[i] && i > 0) {
            return `exon ${exonNumber} ${isMinusStrand ? "donor" : "acceptor"}`
        }
        if (pos == exonEnds[i] && i < exonEnds.length - 1) {
            return `exon ${exonNumber} ${isMinusStrand ? "acceptor" : "donor"}`
        }
    }

    return ""
}

const hasExonAnnotation = (context) => (
    /* Whether the API sent this transcript's exon coordinates at all. They are optional: server.py
       leaves EXON_STARTS/EXON_ENDS out when the database is unavailable. Masking is defined against
       those boundaries, so with none of them present the answer is "unknown", not "unannotated". */
    (context.scores['EXON_STARTS'] || []).length > 0 || (context.scores['EXON_ENDS'] || []).length > 0
)

const isMaskingSite = (pos, context) => {
    /* Whether pos is a site that masking treats as annotated. The two models disagree here. Pangolin
       masks against every annotated position of the transcript, so membership in
       EXON_STARTS/EXON_ENDS is the test. SpliceAI masks against only the single exon boundary
       nearest the variant, so its masked output reports a loss at any other annotated boundary as
       0.00, and this table has to say the same. */
    const boundaries = [...(context.scores['EXON_STARTS'] || []), ...(context.scores['EXON_ENDS'] || [])]
    if (context.tool != "spliceai") {
        return boundaries.includes(pos)
    }
    let nearest = null
    for (const boundary of boundaries.sort((a, b) => a - b)) {
        if (nearest === null || Math.abs(boundary - context.variantPos) < Math.abs(nearest - context.variantPos)) {
            nearest = boundary
        }
    }
    return nearest !== null && pos == nearest
}

const maskPerPositionDelta = ([, kind, compute], row, context) => {
    /* The delta a column shows for this row, with the user's "masked scores" setting applied. The
       /scores endpoint returns the model's raw REF and ALT probabilities, which are the same whether
       or not masking was requested -- masking is applied to the delta scores, not to the
       probabilities they are derived from. Both models define masking the same way: a gain at an
       annotated splice site is not a gain, and a loss at an unannotated site is not a loss. */
    const delta = compute(row)
    if (!context.mask || delta == 0 || !hasExonAnnotation(context)) {
        /* With no exon coordinates, isMaskingSite would answer "not annotated" for every position,
           which zeroes every loss delta while the REF and ALT columns beside them still show the
           drop the loss came from. Show the unmasked delta instead, and say so above the table. */
        return delta
    }
    return isMaskingSite(row.pos, context) == (kind == "gain") ? 0 : delta
}

const buildPerPositionRows = (rows, context) => {
    /* Annotate the score rows returned by the API with what the table and the CSV both need and the
       API does not send: the offset from the variant, whether this is the variant's own position,
       and the splice-site note. The API reports only the positions that cleared the model's
       threshold, plus the variant's own position, so the rows are not contiguous and the
       positionDelta column is what shows where the holes are. */
    /* An insertion's inserted bases have no genomic coordinates, so the model summarizes any score
       inside them onto the variant's own position and reports the true offset separately in
       SCORES_FOR_INSERTED_BASES. The main results table substitutes that offset for the reported 0,
       which this table cannot do because its rows are genomic. Note the variant row instead. */
    const isInsertionWithInsertedBaseScores = (context.scores["SCORES_FOR_INSERTED_BASES"] || []).length > 0
    // row.alt, not context.alt: the model pairs each row's ALT with that row's own REF.
    return rows.map((row) => annotateGenomicScoreRow(row, context, {
        variantAlt: row.alt,
        variantNote: isInsertionWithInsertedBaseScores
            ? "scores inside the inserted bases are summarized here" : "",
    }))
}

const renderScoreTableFromRows = (annotatedRows, context) => {
    /* Render the score table shared by the per-position modal and the inserted-bases modal, so the
       two show the same columns in the same formats rather than drifting apart. Each annotated row
       arrives with its locus and position-delta cells already written out, because the two callers
       fill those differently. */
    const columns = PER_POSITION_COLUMNS[context.tool]
    const deltaColumns = PER_POSITION_DELTA_COLUMNS[context.tool]
    const bodyRows = annotatedRows.map((row) => {
        // escapeHtml every backend-supplied field: this markup goes through jQuery.html().
        const boldIfVariant = row.isVariant ? "font-weight:bold;" : ""
        return `<tr class="${row.isVariant ? "per-position-variant-row" : ""}">
                    <td style="white-space:nowrap; ${boldIfVariant}">${escapeHtml(row.locusText)}</td>
                    <td style="white-space:nowrap">${escapeHtml(row.positionDeltaText)}</td>
                    <td>${escapeHtml(row.note)}</td>
                    ${deltaColumns.map((column) => { const d = maskPerPositionDelta(column, row, context); return `<td ${getScoreStyle(d)}>${formatScore(d)}</td>` }).join("")}
                    ${columns.map(([, key]) => `<td ${getRawScoreStyle(row[key])}>${formatScore(row[key])}</td>`).join("")}
                </tr>`
    })

    // Masking is the user's setting, so when it silently could not be applied the table has to say
    // so -- otherwise the Δ columns read as masked scores that happen to be unmasked.
    const maskingNote = context.mask && !hasExonAnnotation(context)
        ? `<div style="padding-bottom:0.5em">The exon coordinates for this transcript were not returned, so the &#916; columns below are unmasked.</div>`
        : ""

    return `${maskingNote}
            <table class="ui celled table">
                <thead>
                    <tr style="text-align:center">
                        <!-- width:1% shrinks a column to its content, so whichever column omits it
                             absorbs the table's slack. That is notes: its values ("exon 10
                             acceptor") are the only ones that wrap. -->
                        <th style="width:1%">chrom:pos ref (&gt; alt)</th>
                        <th style="width:1%"><span style="white-space:nowrap">position &#916;</span></th>
                        <th>notes</th>
                        ${[...deltaColumns, ...columns].map(([label]) => `<th style="width:1%">${headerLabelHtml(label)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>${bodyRows.join("")}</tbody>
            </table>`
}

const renderPerPositionTable = (rows, context) =>
    renderScoreTableFromRows(buildPerPositionRows(rows, context), context)

const perPositionRowsToCsv = (rows, context) => {
    const columns = PER_POSITION_COLUMNS[context.tool]
    const deltaColumns = PER_POSITION_DELTA_COLUMNS[context.tool]
    // Delta columns first, then the raw REF and ALT scores, matching the order
    // renderPerPositionTable draws. Both write their scores through formatScore, so the download
    // reads the same 2 decimals the table shows. "Δ" is replaced rather than carried into the header
    // so the column names stay ASCII.
    const header = [...deltaColumns, ...columns].map(([label]) =>
        label.toLowerCase().replace(/Δ/gi, "delta").replace(/[()]/g, "").trim().replace(/ +/g, "_"))
    const lines = [["chrom", "position", "position_delta", "ref", "alt", ...header, "notes"].join(",")]
    for (const row of buildPerPositionRows(rows, context)) {
        lines.push([withChrPrefix(context.chrom), row.pos, row.positionDelta, row.ref, row.alt,
                    ...deltaColumns.map((column) => formatScore(maskPerPositionDelta(column, row, context))),
                    ...columns.map(([, key]) => formatScore(row[key])),
                    `"${row.note}"`].join(","))
    }

    return lines.join("\n")
}

const downloadCsv = (filename, csvText) => {
    const url = URL.createObjectURL(new Blob([csvText], {type: "text/csv"}))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
}

// Identifies the most recent modal open, so a slow response for one transcript can't paint over a
// newer one, and so a new search (or batch navigation) supersedes a response still in flight.
let currentPerPositionRequestId = 0

const removeInsertedBasesModals = () => {
    /* Remove the inserted-bases modals left over from a previous search.
     *
     * They are not inside the result rows that get torn down: Semantic UI's detachable default
     * moves each one to body > .ui.dimmer.modals when `.modal()` initializes it, whether or not
     * anyone opened it. Left alone they accumulate on every search, and since modalDialogId is only
     * transcriptIndex*10+i it repeats across searches, so getElementById hands the click handler the
     * older element and opens an earlier search's table. */
    const $modals = $("[id^='modal-with-table']")
    $modals.filter(":visible").modal("hide")
    $modals.remove()
}

// Close an open per-position modal and supersede any response still in flight for it. The modal is a
// top-level overlay rather than part of #response-box, so the hide lists that clear a search's
// results can't reach it.
const dismissPerPositionModal = () => {
    currentPerPositionRequestId++
    if (!$("#per-position-modal").is(":visible")) {
        return
    }
    $("#per-position-modal").modal("hide")
    $("#per-position-download-button, #per-position-visualize-button").hide()
    $("#per-position-modal-content").empty()
}

const openPerPositionModal = async (iconId) => {
    const context = perPositionTableContext[iconId]
    if (!context) {
        return
    }

    currentPerPositionRequestId++
    const requestId = currentPerPositionRequestId

    // The tool is named because the same gene and transcript can be opened from either the SpliceAI
    // or the Pangolin table, and the two modals are otherwise identical at a glance.
    $("#per-position-modal-heading").text(
        `${context.geneName}  ${context.transcriptId}  (${context.strand} strand): ${context.toolName} scores`)
    // Both header buttons are hidden until the modal has content, so the header does not offer
    // actions over an empty box while loading or after a failure.
    $("#per-position-download-button, #per-position-visualize-button").hide()
    // per-position-centered stays on until a table is actually painted, so the spinner and any error
    // message both sit in the middle of the fixed-height box.
    $("#per-position-modal-content").addClass("per-position-centered")
        .html(`<div class="ui active inline loader"></div>`)
    $("#per-position-modal").modal("show")

    let response
    try {
        response = await makeRequest(`${context.scoresUrl}&transcript=${encodeURIComponent(context.transcriptId)}`)
    } catch(e) {
        console.error("Per-position scores request failed:", e)
        if (requestId !== currentPerPositionRequestId) {
            return
        }
        $("#per-position-modal-content").html(`<div style="color:darkred">Unable to load the per-position scores.</div>`)
        return
    }

    if (requestId !== currentPerPositionRequestId) {
        //another transcript's table was opened while this request was in flight, so don't paint
        //these now-stale rows under the newer heading
        return
    }

    if (!response.ok || response.error) {
        $("#per-position-modal-content").html(`<div style="color:darkred">${escapeHtml(response.error || "Unable to load the per-position scores.")}</div>`)
        return
    }

    const rows = response.rows || []
    $("#per-position-modal-content").removeClass("per-position-centered")
        .html(renderPerPositionTable(rows, context))
    $("#per-position-visualize-button").show()
    $("#per-position-download-button").show().off("click").on("click", () => downloadCsv(
        `${context.tool}_${context.chrom}-${context.variantPos}-${context.ref}-${context.alt}_${context.transcriptId}.csv`,
        perPositionRowsToCsv(rows, context)))

    const variantRow = $("#per-position-modal-content .per-position-variant-row")[0]
    if (variantRow) {
        variantRow.scrollIntoView({block: "center"})
    }
}

const buildPerPositionIconHtml = (iconId, nNonZeroScores) => {
    /* The table icon shown in the top-right corner of a transcript's cell. Transcripts whose scoring
       window contains no reportable position get a disabled icon instead, since there would be
       nothing to put in the table. */
    // deliberately not semantic-ui's own "disabled" class, which suppresses pointer events on some
    // elements and would take the hover tooltip with it
    //
    // nNonZeroScores missing entirely means the API revision being talked to predates the
    // per-position table, so /scores would fail too. That's a different message from a count of 0.
    if (!nNonZeroScores) {
        return `<i class="table icon per-position-table-icon per-position-table-icon-disabled" data-position="left center"
                   data-content="${nNonZeroScores == null ? 'Table of scores is not available' : 'All scores are zero'}" style="position:absolute; top:8px; right:8px; color:#cccccc"></i>`
    }

    return `<i class="table icon per-position-table-icon" data-icon-id="${escapeHtml(iconId)}" data-position="left center"
               data-content="Show the predicted scores at each position the model reported in the scoring window, plus the variant's own position"
               style="position:absolute; top:8px; right:8px; color:#000080; cursor:pointer"></i>`
}

const getGnomadDataVersion = (genomeVersion) => {
    return genomeVersion === "38" ? "gnomad_r4" : "gnomad_r2_1"
}

const buildSplicingApiUrl = (normalizedVariant, tool, variant, genomeVersion, basicOrComprehensive, maxDistance, mask, isPositionOnly) => {
    /* The service URL and query string for one tool, shared by the scoring call and by the
       per-position table's /scores call so the two can never disagree about which variant, gene set
       or window they are talking about.
       Route to the service that holds this gene set: each one loads only its own. Sending the wrong
       one still works (the backend 307-redirects to its sibling for the sake of older API clients),
       but routing correctly here avoids the extra round trip. */
    const variantTokens = (normalizedVariant || "---").split("-")
    const chrom = variantTokens[0]
    const pos = variantTokens[1]
    const ref = variantTokens[2]
    const alt = variantTokens[3]

    const baseUrl = baseApiUrl[`${tool.toLowerCase()}-${genomeVersion}`
        + (basicOrComprehensive === "comprehensive" ? "-comprehensive" : "")]
    // encodeURIComponent every value so a '&', '#', or '=' in a user-entered variant cannot inject
    // extra query params
    const enc = encodeURIComponent
    // mask has no meaning without an ALT allele, so a position-only request omits it
    const urlArgs = isPositionOnly
        ? `hg=${enc(genomeVersion)}&bc=${enc(basicOrComprehensive)}&distance=${enc(maxDistance)}&variant=${enc(`${chrom}-${pos}`)}&raw=${enc(variant)}`
        : `hg=${enc(genomeVersion)}&bc=${enc(basicOrComprehensive)}&distance=${enc(maxDistance)}&mask=${enc(mask)}&variant=${enc(`${chrom}-${pos}-${ref}-${alt}`)}&raw=${enc(variant)}`

    return {baseUrl, urlArgs}
}

const fetchSplicingToolJson = async (normalizedVariant, tool, variant, genomeVersion, basicOrComprehensive, maxDistance, mask, isPositionOnly = false) => {
    const {baseUrl, urlArgs} = buildSplicingApiUrl(
        normalizedVariant, tool, variant, genomeVersion, basicOrComprehensive, maxDistance, mask, isPositionOnly)

    let apiResponse
    try {
        apiResponse = await makeRequest(`${baseUrl}/${tool.toLowerCase()}/?${urlArgs}`)
    } catch(e) {
        throw Error(`${tool} API call failed: ${e}`)
    }

    const apiResponseJson = await apiResponse
    console.log(`${tool} API response:`, apiResponseJson)

    if (!apiResponse.ok || apiResponseJson.error) {
        // inputError marks a message about the variant rather than about this tool (eg. a REF allele
        // the reference genome doesn't have). Both tools return the same one, so show it as written
        // instead of wrapping it in a per-tool prefix that reads like two API failures.
        const apiError = Error(apiResponseJson.inputError
            ? `${apiResponseJson.error}`
            : `${tool} API call error ${apiResponseJson.error ? `: ${apiResponseJson.error}` : ""}`)
        apiError.inputError = Boolean(apiResponseJson.inputError)
        throw apiError
    }

    return apiResponseJson
}

const sortScoresForDisplay = (scores, scoreKeys) => (
    /* Sort transcripts for display: MANE/canonical first, protein-coding before non-coding, then by
       the summed absolute scores so the row at the top of the table is the one SAI-10k analyzed.
       Returns a new array; apiResponseJson.scores is deliberately not replaced, since the cached JSON
       is reused when switching between batch variants. */
    _.sortBy(scores, (s) => {
        let scoreSum = 0
        for (const k of scoreKeys) {
            const v = parseFloat(s[k])
            if (!isNaN(v)) scoreSum += Math.abs(v)
        }
        return (
            100*(s['t_priority'].startsWith("M") ? 0 : 1) +
            10* (s['t_type'] == "protein_coding" ? 0 : 1) +
            -1*  TRANSCRIPT_PRIORITY[s['t_priority']] +
            -0.001 * scoreSum
        )
    })
)

const finishTranscriptTable = (tool, tableRows, transcriptCategories, modalDialogIds) => {
    $(`#${tool.toLowerCase()}-header`).after(tableRows.join(""))

    if (transcriptCategories["MS"]) {
        $(".main-transcript-label").html("MANE Select")
    } else if (transcriptCategories["MP"]) {
        $(".main-transcript-label").html("MANE Plus Clinical")
    } else if (transcriptCategories["C"]) {
        $(".main-transcript-label").html("Canonical")
    } else {
        $("#transcript-button-table").hide()
    }

    // initialize any modal dialogs
    for (const modalDialogIndex of modalDialogIds) {
        $(`#table-icon${modalDialogIndex}`).click(() => {
            $(`#modal-with-table${modalDialogIndex}`).modal('show')
        })
    }
    $("#transcript-button-table").show()
    applyTranscriptFilterView(transcriptFilterPreference)
}

const renderSplicingResultsFromApiJson = (apiResponseJson, normalizedVariant, variantConsequence, tool, variant, genomeVersion, basicOrComprehensive, maxDistance, mask, showRefAltScoreColumns, isPositionOnly = false) => {
    /* Render SpliceAI or Pangolin table from an API response JSON (used for single lookups and batch navigation). */

    const variantTokens = (normalizedVariant || "---").split("-")
    const chrom = variantTokens[0]

    if (isPositionOnly) {
        renderPositionOnlyResultsFromApiJson(apiResponseJson, tool, variant, chrom, variantTokens[1], genomeVersion)
        return
    }

    // The service scores the shortest spelling of the variant and measures every position in its
    // response from it, so the rows below use the spelling it scored, not the one that was sent.
    const scoredPos = parseInt(apiResponseJson.pos != null ? apiResponseJson.pos : variantTokens[1])
    const scoredRef = apiResponseJson.ref != null ? apiResponseJson.ref : variantTokens[2]
    const scoredAlt = apiResponseJson.alt != null ? apiResponseJson.alt : variantTokens[3]
    const scoredVariant = `${chrom}-${scoredPos}-${scoredRef}-${scoredAlt}`

    // Restore the shared table headers to their normal (delta-score) wording, in case a prior search
    // on this page was a position-only (REF-only) search that relabeled them.
    $(`#${tool.toLowerCase()}-variant-header`).text("Variant")
    $(`#${tool.toLowerCase()}-type-header-label`).html("&#916;&nbsp; type")
    $(`#${tool.toLowerCase()}-score-header-label`).html("&#916;&nbsp; score &nbsp; ")
    $(`#${tool.toLowerCase()}-position-header-label`).html("position &nbsp; ")
    $(`#${tool.toLowerCase()}-score-header-icon`).attr("data-html", ORIGINAL_HEADER_TOOLTIPS[tool.toLowerCase()].score)
    $(`#${tool.toLowerCase()}-position-header-icon`).attr("data-content", ORIGINAL_HEADER_TOOLTIPS[tool.toLowerCase()].position)

    const scoresSorted = sortScoresForDisplay(
        apiResponseJson.scores, ['DS_AG', 'DS_AL', 'DS_DG', 'DS_DL', 'DS_SL', 'DS_SG'])

    const {baseUrl, urlArgs} = buildSplicingApiUrl(
        normalizedVariant, tool, variant, genomeVersion, basicOrComprehensive, maxDistance, mask, false)

    const transcriptCategories = {}
    const tableRows = []
    const modalDialogIds = []
    let transcriptIndex = 0

    $(`#${tool.toLowerCase()}-header`).nextAll().remove()

    for (const scores of scoresSorted) {
        const isPangolin = tool.toLowerCase() == "pangolin"
        const subRowCount = isPangolin ? 2 : 4
        const isMainTranscript = scores['t_priority'] != "N" && (scores['t_priority'] != "C" || transcriptCategories["MS"] == undefined)

        transcriptCategories[scores['t_priority']] = true

        const resultRowClasses = [`${tool.toLowerCase()}-result-row`]
        if (isMainTranscript) {
            resultRowClasses.push("main-transcript")
        } else {
            resultRowClasses.push("non-main-transcript")
        }
        if(scores['t_type'] == "protein_coding") {
            resultRowClasses.push("coding-transcript")
        } else {
            resultRowClasses.push("non-coding-transcript")
        }

        // everything the per-position table modal needs for this transcript, so its icon only has to
        // carry an id
        const perPositionIconId = `${tool.toLowerCase()}-${transcriptIndex}`
        perPositionTableContext[perPositionIconId] = {
            tool: tool.toLowerCase(),
            // The display spelling, kept alongside the lowercase key: `tool` is lowercased because it
            // looks up column definitions and builds the endpoint path, but the modal heading needs
            // "SpliceAI" / "Pangolin" as written.
            toolName: tool,
            scores: scores,
            chrom: chrom,
            variantPos: scoredPos,
            ref: scoredRef,
            alt: scoredAlt,
            geneName: scores['g_name'],
            transcriptId: scores['t_id'],
            strand: scores['t_strand'] == "-" ? "minus" : "plus",
            // The raw per-position scores the endpoint returns are the same either way, so the
            // setting has to be carried here and applied to the deltas derived from them.
            mask: mask == "1",
            scoresUrl: `${baseUrl}/${tool.toLowerCase()}/scores/?${urlArgs}`,
        }

        let row = `<tr class="${resultRowClasses.join(' ')}">
            ${buildVariantCellHtml(variant, scoredVariant, variantConsequence, genomeVersion, subRowCount)}
            ${buildTranscriptCellHtml(scores, genomeVersion, subRowCount, buildPerPositionIconHtml(perPositionIconId, scores['nNonZeroScores']))}`

        for (const [i, label, scoreKey, positionKey, REF_scoreKey, ALT_scoreKey] of (
            isPangolin ? [
                [0, "Splice Loss", "DS_SL", "DP_SL", "SL_REF", "SL_ALT"],
                [1, "Splice Gain", "DS_SG", "DP_SG", "SG_REF", "SG_ALT"],
            ] : [
                [0, "Acceptor Loss", "DS_AL", "DP_AL", "DS_AL_REF", "DS_AL_ALT"],
                [1, "Donor Loss",    "DS_DL", "DP_DL", "DS_DL_REF", "DS_DL_ALT"],
                [2, "Acceptor Gain", "DS_AG", "DP_AG", "DS_AG_REF", "DS_AG_ALT"],
                [3, "Donor Gain",    "DS_DG", "DP_DG", "DS_DG_REF", "DS_DG_ALT"],
            ])) {
            if (i > 0) {
                row += `</tr><tr class="${resultRowClasses.join(' ')}">`
            }

            const modalDialogId = transcriptIndex*10 + i
            // Same context shape the per-position modal builds, so the two tables render through
            // renderScoreTableFromRows identically. Always spliceai: only SpliceAI reports
            // SCORES_FOR_INSERTED_BASES.
            const detailedScoresTable = generateTableOfScoresForInsertedBases(
                modalDialogId, scores[scoreKey], scores[positionKey], scoredRef, scoredAlt, scores["SCORES_FOR_INSERTED_BASES"],
                {tool: "spliceai", chrom: chrom, variantPos: scoredPos, alt: scoredAlt, scores: scores, mask: mask == "1"})

            if (detailedScoresTable) {
                modalDialogIds.push(modalDialogId)
            }

            row += `<td>${label}</td>
                    <td ${getScoreStyle(scores[scoreKey])}>
                        ${formatScore(scores[scoreKey])}
                        ${detailedScoresTable}
                        </td>
                    <td>${
                        (
                            parseFloat(scores[scoreKey]) == 0 &&
                            parseFloat(scores[REF_scoreKey]) == 0 &&
                            parseFloat(scores[ALT_scoreKey]) == 0
                        )? "" : updatePositionAccountingForInsertedBases(scoreKey, scores[scoreKey], scores[positionKey], scoredRef, scoredAlt, scores["SCORES_FOR_INSERTED_BASES"])}
                    </td>`

            if (showRefAltScoreColumns == "1") {
                row += `<td class="ref-score-column">${formatScore(scores[REF_scoreKey])}</td>
                        <td class="alt-score-column">${formatScore(scores[ALT_scoreKey])}</td>`
            }
        }
        row += "</tr>"

        tableRows.push(row)
        transcriptIndex++
    }

    finishTranscriptTable(tool, tableRows, transcriptCategories, modalDialogIds)
}

const renderPositionOnlyResultsFromApiJson = (apiResponseJson, tool, variant, chrom, pos, genomeVersion) => {
    /* REF-only counterpart of renderSplicingResultsFromApiJson: renders the highest predicted REF
     * acceptor/donor probability (SpliceAI) or splice-site probability (Pangolin) anywhere in the
     * scoring window, per transcript. No delta scores, no ALT allele, no inserted-bases detail and no
     * per-position table (all of those require an ALT). */
    const isPangolin = tool.toLowerCase() == "pangolin"

    // Swap the shared table headers (normally "Δ type" / "Δ score") to REF-only wording.
    $(`#${tool.toLowerCase()}-variant-header`).text("Position")
    $(`#${tool.toLowerCase()}-type-header-label`).text("site type")
    $(`#${tool.toLowerCase()}-score-header-label`).text("REF score ")
    $(`#${tool.toLowerCase()}-position-header-label`).text("position ")
    $(`#${tool.toLowerCase()}-score-header-icon`).attr("data-html", isPangolin
        ? "Pangolin's computed probability that this position is a splice site, based on the reference sequence. No ALT allele was specified, so this is the strongest predicted site anywhere in the scoring window -- not a variant-effect delta."
        : "SpliceAI's computed probability that this position is a splice acceptor or donor, based on the reference sequence. No ALT allele was specified, so this is the strongest predicted site anywhere in the scoring window -- not a variant-effect delta.")
    $(`#${tool.toLowerCase()}-position-header-icon`).attr("data-content",
        "The offset of the strongest predicted site shown in the score column, relative to the queried position. Negative values are to the left in genomic coords, regardless of transcript strand.")

    const scoresSorted = sortScoresForDisplay(
        apiResponseJson.scores, isPangolin ? ['S_REF'] : ['RA_MAX', 'RD_MAX'])

    const transcriptCategories = {}
    const tableRows = []
    const rowDefs = isPangolin
        ? [[0, "Splice site", "S_REF", "DP_S"]]
        : [[0, "Acceptor", "RA_MAX", "RA_MAX_POS"], [1, "Donor", "RD_MAX", "RD_MAX_POS"]]
    const subRowCount = rowDefs.length

    $(`#${tool.toLowerCase()}-header`).nextAll().remove()

    for (const scores of scoresSorted) {
        const isMainTranscript = scores['t_priority'] != "N" && (scores['t_priority'] != "C" || transcriptCategories["MS"] == undefined)

        transcriptCategories[scores['t_priority']] = true

        const resultRowClasses = [`${tool.toLowerCase()}-result-row`]
        resultRowClasses.push(isMainTranscript ? "main-transcript" : "non-main-transcript")
        resultRowClasses.push(scores['t_type'] == "protein_coding" ? "coding-transcript" : "non-coding-transcript")

        let row = `<tr class="${resultRowClasses.join(' ')}">
            ${buildPositionCellHtml(variant, chrom, pos, genomeVersion, subRowCount)}
            ${buildTranscriptCellHtml(scores, genomeVersion, subRowCount)}`

        for (const [i, label, scoreKey, positionKey] of rowDefs) {
            if (i > 0) {
                row += `</tr><tr class="${resultRowClasses.join(' ')}">`
            }
            // getScoreStyle, deliberately, even though these are raw REF probabilities rather than
            // delta scores: the green/yellow/red tiers are reused here for scannability, so a strong
            // predicted splice site is visible without reading every number.
            row += `<td>${label}</td>
                    <td ${getScoreStyle(scores[scoreKey])}>${formatScore(scores[scoreKey])}</td>
                    <td>${escapeHtml(scores[positionKey])} bp</td>`
        }
        row += "</tr>"

        tableRows.push(row)
    }

    finishTranscriptTable(tool, tableRows, transcriptCategories, [])
}

const TRANSCRIPT_PRIORITY_VIEW_LOOKUP = {
    "MS": `<a href="https://www.ncbi.nlm.nih.gov/refseq/MANE" target="_blank">MANE Select transcript</a>`,
    "MP": `<a href="https://www.ncbi.nlm.nih.gov/refseq/MANE" target="_blank">MANE Plus Clinical transcript</a>`,
    "C": "Canonical transcript",
}

const buildVariantCellHtml = (variant, normalizedVariant, variantConsequence, genomeVersion, rowspan) => {
        const variantTokens = (normalizedVariant || "---").split("-")
        const chrom = variantTokens[0]
        const pos = variantTokens[1]
        const ref = variantTokens[2]
        const alt = variantTokens[3]
        const gnomadVersion = getGnomadDataVersion(genomeVersion)

        const variantConsequenceDiv = variantConsequence ? `
            <div style="display: inline-block">
                <a href="https://www.ensembl.org/info/genome/variation/prediction/predicted_data.html" class="small-link" target="_blank">
                ${escapeHtml(variantConsequence.replace(/_/g, ' '))}
                </a>
             </div>
             <br class="only-large-screen"/>
             ` : ""

        const noDifferenceDueToNormalization = variant.toLowerCase().trim().replace(/^chr/, "").replace(/[>: _-]+/g, "-") == normalizedVariant.toLowerCase().trim().replace(/^chr/, "").replace(/[>: _-]+/g, "-")
        const normalizedVariantDiv = noDifferenceDueToNormalization ? "" :
            `<br class="only-large-screen"/>
             <div style="margin-left:5px;margin-right:10px; display: inline-block; color:#333333">
                <i>⇒ ${chrom}:${pos} ${truncateAllele(ref)} &gt; ${truncateAllele(alt)}</i>
             </div>
             <br class="only-large-screen"/>`

        return `<td rowspan="${rowspan}" style="vertical-align: top">
                    <div style="margin-right:10px; display: inline-block">${escapeHtml(truncateVariantString(variant))}</div><br class="only-large-screen"/>
                    ${normalizedVariantDiv}
                    <br class="only-large-screen"/>
                    ${variantConsequenceDiv}
                    <a href="${getUCSCBrowserUrl(genomeVersion, chrom, pos)}" class="small-link" target="_blank">UCSC</a>,
                    <a href="https://gnomad.broadinstitute.org/variant/${chrom}-${pos}-${ref}-${alt}?dataset=${gnomadVersion}" class="small-link" target="_blank">gnomAD</a>
                    <br class="only-large-screen"/>

                </td>`
    }

const buildPositionCellHtml = (variant, chrom, pos, genomeVersion, rowspan) => {
        // REF-only counterpart of buildVariantCellHtml: no ref/alt, so no normalization diff and no
        // gnomAD link (it needs an allele).
        return `<td rowspan="${rowspan}" style="vertical-align: top">
                    <div style="margin-right:10px; display: inline-block">${escapeHtml(variant)}</div><br class="only-large-screen"/>
                    <a href="${getUCSCBrowserUrl(genomeVersion, chrom, pos)}" class="small-link" target="_blank">UCSC</a>
                    <br class="only-large-screen"/>
                </td>`
    }

const buildTranscriptCellHtml = (scores, genomeVersion, rowspan, perPositionIconHtml = "") => {
        const gnomadVersion = getGnomadDataVersion(genomeVersion)
        const strand = scores['t_strand'] == "-" ? "minus" : "plus"
        const refSeqLink = scores['t_refseq_ids']? `/ <a href="https://www.ncbi.nlm.nih.gov/search/all/?term=${encodeURIComponent(scores['t_refseq_ids'][0])}" target="_blank">${escapeHtml(scores['t_refseq_ids'][0])}</a>` : ""

        // position:relative anchors the per-position table icon to the cell's top-right corner
        return `<td rowspan="${rowspan}" style="vertical-align: top; position: relative; padding-right: 30px">
                    ${perPositionIconHtml}
                    <div style="margin-right:10px; display: inline-block">
                        ${escapeHtml(scores['g_name'])}
                            <div class="small-link"> (&nbsp;<a href="https://useast.ensembl.org/Homo_sapiens/Gene/Summary?g=${encodeURIComponent(scores['g_id'].split('.')[0])}" target="_blank">${escapeHtml(scores['g_id'])}</a>
                                 / <a href="https://useast.ensembl.org/Homo_sapiens/Transcript/Summary?t=${encodeURIComponent(scores['t_id'].split('.')[0])}" target="_blank">${escapeHtml(scores['t_id'])}</a>
                                 ${refSeqLink})
                            </div><br />
                            <br class="only-large-screen" />
                        <div class="small-link"><a href="https://www.gencodegenes.org/pages/biotypes.html" target="_blank">${escapeHtml(scores['t_type'].replace(/_/g, " "))}</a></div>
                        <div class="small-link">${scores['t_priority'] != "N" ? TRANSCRIPT_PRIORITY_VIEW_LOOKUP[scores['t_priority']] : ""}</div>
                        <div class="small-link"> (${escapeHtml(strand)} strand)</div>
                    </div><br class="only-large-screen" />
                    <br class="only-large-screen" />
                    <a href="https://www.omim.org/search?search=${encodeURIComponent(scores['g_name'])}" class="small-link" target="_blank">OMIM</a>,
                    <a href="https://gtexportal.org/home/gene/${encodeURIComponent(scores['g_name'])}" class="small-link" target="_blank">GTEx</a>,
                    <a href="https://gnomad.broadinstitute.org/gene/${encodeURIComponent(scores['g_name'])}?dataset=${encodeURIComponent(gnomadVersion)}" class="small-link" target="_blank">gnomAD</a>,
                    <a href="https://search.clinicalgenome.org/kb/genes?page=1&size=25&search=${encodeURIComponent(scores['g_name'])}" class="small-link" target="_blank">ClinGen</a>,
                    <a href="https://useast.ensembl.org/Homo_sapiens/Gene/Summary?g=${encodeURIComponent(scores['g_name'])}" class="small-link" target="_blank">Ensembl</a>,
                    <a href="https://www.deciphergenomics.org/gene/${encodeURIComponent(scores['g_name'])}" class="small-link" target="_blank">Decipher</a>,
                    <a href="https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodeURIComponent(scores['g_name'])}" class="small-link" target="_blank">GeneCards</a>
                </td>`
    }

const generateSai10kTable = (spliceaiResponseJson, genomeVersion) => {
    /* Render the SAI-10k-calc prediction row(s) into the "Predicted Splicing Consequences" table.
     * Hidden when SpliceAI itself failed; shows a "no prediction available" placeholder when SpliceAI
     * succeeded but no aberrations were predicted. */
    $("#sai10k-header").nextAll().remove()

    if (!spliceaiResponseJson || spliceaiResponseJson.error) {
        $("#sai10k-table").hide()
        return
    }

    const sai10kPredictions = spliceaiResponseJson.sai10kPredictions
    const sai10kAberrations = sai10kPredictions ? (sai10kPredictions.aberrations || []) : []
    const hasPrediction = sai10kAberrations.length > 0

    // Match the transcript SAI-10k-calc scored against so the Transcript cell makes
    // the reference transcript explicit (exon numbering depends on it). Fall back
    // to the highest-priority scored transcript if transcript_id is missing.
    const allScores = spliceaiResponseJson.scores || []
    const scoresForSai10k = (sai10kPredictions && allScores.find(s => s.t_id === sai10kPredictions.transcript_id)) || allScores[0]
    const transcriptCell = scoresForSai10k
        ? buildTranscriptCellHtml(scoresForSai10k, genomeVersion, 1)
        : `<td></td>`

    // Mirror renderSplicingResultsFromApiJson's main-transcript / coding-transcript
    // class assignment so the SAI-10k row picks up the same blue (MANE Select) /
    // white (coding) / gray (non-coding) background as the row above.
    const sai10kRowClasses = []
    if (scoresForSai10k) {
        const hasMs = allScores.some(s => s.t_priority === "MS")
        const isMain = scoresForSai10k.t_priority !== "N" && (scoresForSai10k.t_priority !== "C" || !hasMs)
        sai10kRowClasses.push(isMain ? "main-transcript" : "non-main-transcript")
        sai10kRowClasses.push(scoresForSai10k.t_type === "protein_coding" ? "coding-transcript" : "non-coding-transcript")
    }

    const tooltip = "SAI-10k-calc interprets SpliceAI outputs to predict splicing aberration type (pseudoexonization, whole/partial intron retention, partial exon deletion, exon skipping), the size of inserted/deleted sequence, and effect on reading frame. It has 95% sensitivity and 96% specificity, with &gt;81% accuracy for predicting pseudoexon, partial intron retention, and exon skipping (<a href='https://academic.oup.com/bioinformatics/article/39/4/btad179/7109800' target='_blank'>Canson et al. 2023</a>). We recommend setting 'Max distance' to 10,000 in order to better capture whole intron retention and multi-exon skipping events."
    const labelCell = `<td style="vertical-align: top; white-space: nowrap">SAI-10k-calc <i class="question circle outline icon" data-position="right center" data-html="${tooltip}"></i></td>`

    let valueCell, visualizeCell
    if (!hasPrediction) {
        valueCell = `<td style="vertical-align: top; color: #888; font-style: italic; white-space: nowrap;">No prediction</td>`
        visualizeCell = `<td class="sai10k-visualize-cell"></td>`
    } else {
        const formatIntegers = (value) => String(value).replace(/\d+/g, (match) => parseInt(match).toLocaleString())
        // aberration.description is a typed dict:
        //   { label, size_bp, size_is_coding, consequence, status,
        //     introduces_stop_codon, extends_past_native_stop }
        // Rendered layout: "{label} ({size_bp}bp[ coding seq.][ {consequence}]) - {status}"
        // followed by an optional PTC clause and an optional extends-past
        // clause. status keywords are colored / italicized per class.
        const renderDescription = (d, frameshift) => {
            if (!d) return ''
            let out = formatIntegers(escapeHtml(d.label))
            const parenParts = []
            if (d.size_bp !== null && d.size_bp !== undefined) {
                parenParts.push(`${formatIntegers(d.size_bp)}bp${d.size_is_coding ? ' coding seq.' : ''}`)
            }
            if (d.consequence) {
                parenParts.push(formatIntegers(escapeHtml(d.consequence)))
            }
            if (parenParts.length) {
                out += ` (${parenParts.join(' ')})`
            }
            if (d.status) {
                const colors = {
                    'in-frame': '#080',
                    'coding': '#080',
                    'frameshift': '#c00',
                    'non-coding change': '#7b68ee',
                    'start codon lost': '#c00',
                    'stop codon lost': '#c00',
                }
                const italics = new Set([
                    'size unclear', 'could not be mapped', 'unknown',
                ])
                const statusEsc = escapeHtml(d.status)
                let statusHtml
                if (colors[d.status]) {
                    statusHtml = `<span style="color: ${colors[d.status]};">${statusEsc}</span>`
                } else if (italics.has(d.status)) {
                    statusHtml = `<span style="color: #888; font-style: italic;">${statusEsc}</span>`
                } else {
                    statusHtml = statusEsc
                }
                out += ` - ${statusHtml}`
            }
            if (d.introduces_stop_codon && frameshift !== true) {
                // Frameshift events already imply a PTC, so omit the suffix
                // there. In-frame / non-codon PTCs still get
                // " but introduces a stop codon".
                out += `<span style="color: #c00;"> but introduces a stop codon</span>`
            }
            if (d.extends_past_native_stop) {
                out += ' and extends past the native stop'
            }
            return out
        }

        const first = sai10kAberrations[0]

        // The backend populates wt_protein_window / altered_protein_window
        // dicts whenever a coding-affecting aberration has a renderable
        // protein-level change:
        //   * PTC: stop_codon_introduced=true. WT keeps a full visible
        //     window with changed_aa=null; altered has changed_aa = the
        //     PTC region (incl. trailing '*') and terminates there.
        //   * In-frame coding change (no PTC, frameshift=false). Both
        //     windows carry a bracketed changed_aa with visible flanks on
        //     both sides (visible_aa = before, trailing_visible_aa =
        //     after). For pure deletion the altered changed_aa is ''
        //     (rendered as a `|` site marker); symmetric for pure
        //     insertion on the WT side.
        // Window dict shape:
        //   { prefix_hidden_aa, visible_aa, changed_aa,
        //     trailing_visible_aa, suffix_hidden_aa, total_aa }
        // Inline styles use single quotes so they don't collide with the
        // data-html="" wrapper.
        const aaChangeIcon = (ab) => {
            const wt = ab.wt_protein_window
            const alt = ab.altered_protein_window
            if (!wt || typeof wt !== 'object' || !alt || typeof alt !== 'object') {
                return ''
            }
            const cell = (s) => `<td style='padding: 2px 10px 2px 0;'>${s}</td>`
            // Hidden-flank cells: `+` faces inward toward the sequence on
            // both sides — prefix reads "221 aa +", suffix reads "+ 81 aa"
            // — and the count itself is bold.
            const aaCell = (n, side) => {
                if (!n) return cell('')
                const num = `<b>${formatIntegers(n)}</b> aa`
                const inner = side === 'prefix' ? `${num}&nbsp;+` : `+&nbsp;${num}`
                return `<td style='padding: 2px 10px 2px 0; white-space: nowrap;'>${inner}</td>`
            }
            // Long inserted/deleted blocks (>50 aa) are mid-truncated as
            // first 25 + ... + last 25 so the popup width stays bounded.
            const truncateChanged = (s) => s.length > 50 ? `${s.slice(0, 25)}...${s.slice(-25)}` : s
            const row = (p) => {
                const visibleHtml = formatIntegers(escapeHtml(p.visible_aa))
                const trailingHtml = formatIntegers(escapeHtml(p.trailing_visible_aa || ''))
                let changedHtml
                if (p.changed_aa === '') {
                    // Pure insertion (WT side) / pure deletion (altered
                    // side): bold change-site marker.
                    changedHtml = `<span style='color: #e67e22; font-weight: bold;'>|</span>`
                } else if (p.changed_aa) {
                    const display = truncateChanged(p.changed_aa)
                    changedHtml = `<span style='color: #e67e22;'>[${formatIntegers(escapeHtml(display))}]</span>`
                } else {
                    changedHtml = ''
                }
                const middle = `${visibleHtml}${changedHtml}${trailingHtml}`
                const totalCell = `<td style='padding: 2px 10px 2px 0; white-space: nowrap;'><div style='display: flex; justify-content: space-between; gap: 1em;'><span>=</span><span><b>${formatIntegers(p.total_aa)}</b> aa total</span></div></td>`
                return `<tr>${aaCell(p.prefix_hidden_aa, 'prefix')}${cell(middle)}${aaCell(p.suffix_hidden_aa, 'suffix')}${totalCell}</tr>`
            }
            const html = `<table style='border-collapse: collapse;'>` +
                `<tr><td colspan='4' style='padding: 2px 0 0 0; text-align: left;'><b>Original protein sequence:</b></td></tr>` +
                row(wt) +
                `<tr><td colspan='4' style='padding: 8px 0 0 0; text-align: left;'><b>Predicted protein sequence:</b></td></tr>` +
                row(alt) +
                `</table>`
            return ` <i class="table icon score-table" style="margin-left: 7px; color: #000080; cursor: pointer;" data-position="right center" data-html="${html}"></i>`
        }

        // Max Δ score is already shown in the SpliceAI scores table above; the
        // "confidence" label is derived from SpliceAI score thresholds (not from
        // SAI-10k-calc's own prediction accuracy); the delta_type column ("acceptor
        // loss" etc.) is also already shown in the SpliceAI Δ-type column. We omit
        // all three here to avoid redundant or misleading text.
        let inner
        if (sai10kAberrations.length === 1) {
            const d = first.description
            inner = d ? `<span style="color: #666;">${renderDescription(d, first.frameshift)}${aaChangeIcon(first)}</span>` : ''
        } else {
            // One visualize link covers all aberrations (they share an IGV view).
            const items = sai10kAberrations
                .filter(ab => ab.description)
                .map(ab => `<li style="margin: 2px 0;">${renderDescription(ab.description, ab.frameshift)}${aaChangeIcon(ab)}</li>`)
                .join('')
            inner = items
                ? `<ul style="margin: 0; padding-left: 0; color: #666; list-style: disc inside;">${items}</ul>`
                : ''
        }
        valueCell = `<td style="vertical-align: top; white-space: nowrap">${inner}</td>`
        visualizeCell = `<td class="sai10k-visualize-cell" style="vertical-align: top; white-space: nowrap"><a href="#" class="sai10k-visualize-link">visualize</a></td>`
    }

    $("#sai10k-header").after(`<tr class="${sai10kRowClasses.join(' ')}">${transcriptCell}${labelCell}${valueCell}${visualizeCell}</tr>`)

    // The page-wide popup() init runs before this function, so attach the popup to
    // the SAI-10k-calc question icon now that the row has been injected.
    $("#sai10k-table .question").popup({on: "click", lastResort: "bottom left"})
        .css({color: "#666666", cursor: "pointer"})
    // The protein-window icon (table-icon, score-table class) is also injected by
    // this function and needs its own post-render popup binding.
    $("#sai10k-table .score-table").popup({on: "click", lastResort: "bottom left"})

    $(".sai10k-visualize-link").click(async (e) => {
        e.preventDefault()
        document.body.style.cursor = 'wait'
        $("#show-igv-button").click()
        setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
            document.body.style.cursor = 'default'
        }, 1500)
    })

    $("#sai10k-table").show()
}


const generateOtherPredictorsTable = async (normalizedVariant, variantConsequence, variant, genomeVersion) => {
    /* Generate the results table to show either the SpliceAI or Pangolin scores */
    console.log(`Generating other scores table for ${normalizedVariant} from ${primateAndPromoterAiTableUrls[genomeVersion]}`)

    const variantTokens = (normalizedVariant || "---").split("-")
    const chrom = `chr${variantTokens[0].replace("chr", "")}`
    const pos = parseInt(variantTokens[1])
    const ref = variantTokens[2]
    const alt = variantTokens[3]

    //example variant: 1-55039916-G-A  (hg38)

    const otherPredictorScores = {}
    const queryLookupTable = async () => {
        await Promise.all([
            primateAndPromoterAiTables[genomeVersion].getLines(chrom, pos-1, pos, line => {
                //console.log("Got line:", line)
                const fields = line.split('\t')
                const lineChrom = fields[0]
                const linePos = parseInt(fields[1])
                const lineRef = fields[2]
                const lineAlt = fields[3]
                //console.log("`Got scores`:", fields)

                if (linePos != pos || lineRef != ref || lineAlt != alt) {
                    return
                }
                const percentile = parseFloat(fields[4])
                const genePercentilethreshold = parseFloat(fields[5])
                //console.log("PrimateAI-3D", percentile, genePercentilethreshold)
                if (!isNaN(percentile)) {
                    otherPredictorScores['primateai3d']  = {
                        'percentile': percentile,
                        'genePercentileThreshold': genePercentilethreshold,
                    }
                }
                const promoterAiScore = parseFloat(fields[6])
                //console.log("PromoterAI", promoterAiScore)
                if (!isNaN(promoterAiScore)) {
                    otherPredictorScores['promoterai'] = {
                        'score': promoterAiScore,
                    }
                }
            },),

            alphaMissenseTables[genomeVersion].getLines(chrom, pos-1, pos, line => {
                //console.log("Got line:", line)
                const fields = line.split('\t')
                const lineChrom = fields[0]
                const linePos = parseInt(fields[1])
                const lineRef = fields[2]
                const lineAlt = fields[3]
                //console.log("`Got scores`:", fields)

                if (linePos != pos || lineRef != ref || lineAlt != alt) {
                    return
                }
                //const transcriptId = fields[6]
                //const proteinVariant = fields[7]
                //const consequence = fields[9]  //benign, ambiguous, pathogenic
                const alphaMissenseScore = parseFloat(fields[8])

                //console.log("AlphaMissense", alphaMissenseScore)
                if (!isNaN(alphaMissenseScore)) {
                    otherPredictorScores['alphamissense'] = {
                        'score': alphaMissenseScore,
                        //'transcriptId': transcriptId,
                        //'proteinVariant': proteinVariant,
                        //'consequence': consequence,
                    }
                }
            },)
        ])
    }

    const queryGnomAD = async () => {
        console.log("Querying gnomAD")
        query = `{
            variant(variantId: "${chrom.replace("chr", "")}-${pos}-${ref}-${alt}", dataset: ${getGnomadDataVersion(genomeVersion)}) {
            in_silico_predictors {
                id,
                value
            },
            }
        }`

        let response
        try {
            response = await fetch("https://gnomad.broadinstitute.org/api", {
                "method": "POST",
                "headers": {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                "body": JSON.stringify({ query }),
            }) //, { mode: 'no-cors' })
        } catch (e) {
            console.error("gnomAD query failed:", e)
            return
        }


        if (response.ok) {
            const responseJson = await response.json()
            console.log("gnomAD response:", responseJson)
            if (responseJson && responseJson.data && responseJson.data.variant) {
                /*
                if (responseJson.data.variant.joint && responseJson.data.variant.joint.ac && responseJson.data.variant.joint.an) {
                    otherPredictorScores.push({
                        'name': 'gnomAD',
                        'score': `AC: ${responseJson.data.variant.joint.ac}, &nbsp; AN: ${responseJson.data.variant.joint.an}`,
                    })
                }
                */

                if (responseJson.data.variant.in_silico_predictors) {
                    responseJson.data.variant.in_silico_predictors.forEach((predictor) => {
                        if (predictor.id.startsWith("spliceai") || predictor.id.startsWith("pangolin")) {
                            return
                        }
                        const predictorName = predictor.id
                        const score = parseFloat(parseFloat(predictor.value).toFixed(3))
                        if (otherPredictorScores[predictorName] && Math.abs(otherPredictorScores[predictorName].score - score) > 0.001) {
                            console.warn(`Mismatch between gnomAD and myvariant.info scores for ${predictorName}: ${score} vs ${otherPredictorScores[predictorName].score}`)
                        }
                        otherPredictorScores[predictorName] = {
                            'score': score,
                        }
                    })
                }
            }
        }
    }

    const queryMyVariantInfo = async () => {
        console.log("Querying myvariant.info")
        const variantId = `${chrom}:g.${pos}${ref}>${alt}`
        //add a data section to the body of the request
        let response
        try {
            response = await fetch(`https://myvariant.info/v1/variant/${encodeURIComponent(variantId)}?fields=dbnsfp&size=10&assembly=${genomeVersion == '37' ? 'hg19' : 'hg38'}`, {
                "method": "GET",
                "headers": {
                    "accept": "*/*",
                }
            })
        } catch (e) {
            console.error("myvariant.info query failed:", e)
            return
        }

        if (response.ok) {
            const responseJson = await response.json()
            console.log("myvariant.info response:", responseJson)
            if (responseJson.dbnsfp) {
                for (const otherPredictorName of [
                    "revel.score", "cadd.phred", "alphamissense.score", "sift.score",
                ]) {
                    const keyTokens = otherPredictorName.split(".")
                    const key1 = keyTokens[0]
                    const key2 = keyTokens[1]
                    if (responseJson.dbnsfp[key1] && responseJson.dbnsfp[key1][key2] != null) {
                        let score = responseJson.dbnsfp[key1][key2]
                        if (Array.isArray(score)) {
                            score = score[0]  // if its an array, get the first elegment
                        }
                        const otherPredictorName = key1.replace("revel", "revel_max").replace("sift", "sift_max")
                        if (otherPredictorScores[otherPredictorName]) {
                            if (Math.abs(otherPredictorScores[otherPredictorName].score - score) > 0.001) {
                                console.error(`Mismatch between myvariant.info and gnomAD scores for ${key1}: ${score} vs ${otherPredictorScores[otherPredictorName].score}`)
                            }
                        } else {
                            otherPredictorScores[otherPredictorName] = {
                                'score': parseFloat(parseFloat(score).toFixed(3)),
                            }
                        }
                    }
                }
            }
        }
    }

    console.log("Querying lookup tables, gnomAD, and myvariant.info")
    await Promise.all([queryLookupTable(), queryGnomAD(), queryMyVariantInfo()]) //.map(p => p.catch(e => ({'error': e.message})))

    console.log("Other predictors scores:", otherPredictorScores)
    const noDifferenceDueToNormalization = variant.toLowerCase().trim().replace(/^chr/, "").replace(/[>: _-]+/g, "-") == normalizedVariant.toLowerCase().trim().replace(/^chr/, "").replace(/[>: _-]+/g, "-")
    const normalizedVariantDiv = noDifferenceDueToNormalization ? "" :
        `<br class="only-large-screen"/>
            <div style="margin-left:5px;margin-right:10px; display: inline-block; color:#333333">
            <i>⇒ ${chrom}:${pos} ${ref}&gt;${alt}</i>
            </div>
            <br class="only-large-screen"/>`


    const otherPredictorNames = [
        "alphamissense", "cadd", "phylop", "polyphen_max", "primateai3d", "promoterai", "revel_max", "sift_max",
    ]

    const otherPredictorMap = {}
    for (const [otherPredictorName, otherPredictor] of Object.entries(otherPredictorScores)) {
        otherPredictorMap[otherPredictorName] = otherPredictor
    }

    $(`#other-predictors-header`).nextAll().remove()
    let firstColumn = `
        <td class="eight wide column" style="vertical-align: top" rowSpan="${Object.keys(otherPredictorScores).length}">
            <div style="margin-right:10px; display: inline-block">${variant}</div><br class="only-large-screen"/>
            ${normalizedVariantDiv}
        </td>`


    const tableRows = []
    const missingScores = []
    for (const otherPredictorName of otherPredictorNames) {
        const predictorLabel = nameMapForPredictorScores[otherPredictorName] || otherPredictorName
        const otherPredictor = otherPredictorMap[otherPredictorName]
        const bgColor = otherPredictor && colorMapForPredictorScores[otherPredictorName] ? colorMapForPredictorScores[otherPredictorName](otherPredictor) : "#ffffff"
        const helpIcon = otherPredictor && helpTextForPredictorScores[otherPredictorName] ? `<i class='question circle outline icon' data-html="${helpTextForPredictorScores[otherPredictorName](otherPredictor)}"></i>` : ""

        let row = `<tr>${firstColumn}<td class="four wide column" style="vertical-align: top; white-space: nowrap">${predictorLabel}</td>`
        if (otherPredictorName == "primateai3d") {
            if (otherPredictor) {
                row += `<td class="three wide column" style="vertical-align: top; white-space: nowrap; background-color: ${bgColor}">${otherPredictor.percentile.toFixed(2)} &nbsp; (gene-specific threshold: ${otherPredictor.genePercentileThreshold.toFixed(2)}) &nbsp; ${helpIcon}</td><td class="one wide column" style="background-color: ${bgColor}"></td></tr>`
                tableRows.push(row)
                firstColumn = ""
            } else {
                missingScores.push(otherPredictorName)
            }
        } else if (otherPredictorName == "promoterai") {
            if (otherPredictor) {
                row += `<td class="three wide column" style="vertical-align: top; white-space: nowrap; background-color: ${bgColor}">${otherPredictor.score.toFixed(2)} &nbsp; ${helpIcon}</td>
                <td class="one wide column" style="vertical-align: top; white-space: nowrap; background-color: ${bgColor}"></td></tr>`
                tableRows.push(row)
                firstColumn = ""
            } else {
                missingScores.push(otherPredictorName)
            }
        } else if (otherPredictorName in predictorScoreToPoints) {
            if (otherPredictor) {
                row += `<td class="three wide column" style="vertical-align: top; white-space: nowrap; background-color: ${bgColor}">${otherPredictor.score}</td>`
                if (variantConsequence && variantConsequence.toLowerCase().includes("missense")) {
                    row += `<td class="one wide column" style="vertical-align: top; text-align: right; white-space: nowrap; background-color: ${bgColor}">
                            ${predictorScoreToPoints[otherPredictorName](otherPredictor)}&nbsp;${helpIcon}
                        </td></tr>`
                } else {
                    row += `<td class="one wide column" style="background-color: ${bgColor}"></td>`
                }
                tableRows.push(row)
                firstColumn = ""
            } else {
                missingScores.push(otherPredictorName)
            }
        } else {
            console.error("Unknown predictor", otherPredictorName)
        }
    }

    if (missingScores.length > 0) {
        console.log("Missing scores for", missingScores)
        const missingScoresRow = `<tr><td class="four wide column"></td><td class="four wide column" style="vertical-align: top; white-space: nowrap" colspan="3"><div style="padding-top: 10px; display:inline-block">${missingScores.map((name, i) => `${i === 0 || i < missingScores.length - 1 ? nameMapForPredictorScores[name] : 'and ' + nameMapForPredictorScores[name]}`).join(", &nbsp;")} scores are not available for this variant &nbsp; <i class='question circle outline icon' data-position='right center' data-content='AlphaMissense, PrimateAI-3D, and PromoterAI scores are retrieved from public lookup tables of precomputed scores, while CADD, PhyloP, PolyPhen, REVEL, and SIFT scores are retrieved from the gnomAD and myvariant.info APIs'/></div></td></tr>`
        tableRows.push(missingScoresRow)
    }
    $("#other-predictors-header").after(tableRows.join(""))
}

const applyTranscriptFilterView = (category) => {
    $("#main-transcript-button, #all-transcript-button").removeClass("primary")
    $(`#${category}-transcript-button`).addClass("primary")

    if (category == "main") {
        $(".spliceai-result-row").hide()
        $(".spliceai-result-row.main-transcript").show()
    } else if (category == "all") {
        $(".spliceai-result-row").show()
    }
}

const updateTranscriptButtons = (category) => {
    transcriptFilterPreference = category
    applyTranscriptFilterView(category)
}

const updateControlsForPositionOnlyMode = (isPositionOnly) => {
    /* Grey out/relabel controls that have no effect on a position-only (REF-only) search: "masked
     * scores" and "REF & ALT scores" (mask is omitted from the API call and the REF/ALT columns are
     * always hidden), and the SpliceAI/Pangolin delta-score IGV tracks (position-only has no ALT to
     * compute a delta against). The delta-score checkboxes are also unchecked while disabled so they
     * don't look active for a track that isn't being rendered; their pre-position-only checked state
     * is restored when returning to normal mode. The "SpliceAI REF & ALT scores" IGV checkbox is
     * relabeled since that track only ever shows REF (no ALT) in this mode. The Variant track stays
     * enabled and is relabeled "Ref. position" -- it renders a synthetic 1bp block at the queried
     * position instead of a variant. */
    const inapplicableCheckboxes = $("input[name='mask'], input[name='show-ref-alt']")
    inapplicableCheckboxes.closest(".ui.checkbox").checkbox(isPositionOnly ? "disable" : "enable")

    const deltaTrackNames = ["igv-spliceai-delta-scores", "igv-pangolin-delta-scores"]
    const deltaTrackCheckboxes = $(deltaTrackNames.map((name) => `input[name='${name}']`).join(", "))
    // Only capture/restore on the actual mode transition, not on every call -- a call where the mode
    // is unchanged from the previous one must leave the checkboxes exactly as the user last set them.
    const enteringPositionOnly = isPositionOnly && !wasPositionOnly
    const leavingPositionOnly = !isPositionOnly && wasPositionOnly
    if (isPositionOnly) {
        if (enteringPositionOnly) {
            // Capture the real preference before forcing these checkboxes off, so it can be restored
            // later (see updateVisualizationCheckboxes for how this captured value also keeps
            // localStorage from being corrupted while unchecked).
            for (const name of deltaTrackNames) {
                deltaTrackCheckedBeforePositionOnly[name] = $(`input[name='${name}']`).prop("checked")
            }
        }
        deltaTrackCheckboxes.closest(".ui.checkbox").checkbox("uncheck").checkbox("disable")
    } else {
        deltaTrackCheckboxes.closest(".ui.checkbox").checkbox("enable")
        if (leavingPositionOnly) {
            for (const name of deltaTrackNames) {
                if (deltaTrackCheckedBeforePositionOnly[name]) {
                    $(`input[name='${name}']`).closest(".ui.checkbox").checkbox("check")
                }
            }
        }
    }
    wasPositionOnly = isPositionOnly

    $("input[name='igv-spliceai-ref-alt']").siblings("label")
        .text(isPositionOnly ? "SpliceAI REF scores" : "SpliceAI REF & ALT scores")
    $("input[name='igv-variant']").siblings("label")
        .text(isPositionOnly ? "Ref. position" : "variant track")
}

const updateVisualizationCheckboxes = (readFromLocalStorage, genomeVersion) => {
    /** 
     * Retrieve and save the current state of checkboxes in the Visualization section, or set the state of these 
     * checkboxes based on cookies / local storage.
     */
    let tracksToShow
    if (readFromLocalStorage) {
        // default tracks
        tracksToShow = {
            "igv-variant": true,
            "igv-spliceai-ref-alt": true,
            "igv-spliceai-delta-scores": true,
            "igv-pangolin-delta-scores": true,
        }

        // if there are tracksToShow in local storage, overwrite defaults with those settings
        const fromStorage = localStorage.getItem("tracksToShow")
        let fromStorageJson = null
        if (fromStorage) {
            try {
                fromStorageJson = JSON.parse(fromStorage)
            } catch (e) {
                console.warn("Could not parse tracksToShow from localStorage; resetting:", e)
                localStorage.removeItem("tracksToShow")
            }
        }
        if (fromStorageJson) {
            for (const key of Object.keys(fromStorageJson)) {
                tracksToShow[key] = fromStorageJson[key]
                try {
                    $(`input[name='${key}']`).prop( "checked", tracksToShow[key] )
                } catch (e) {
                    console.log(e)
                }
            }
        }
    } else {

        // retrieve state from checkboxes
        tracksToShow = {}
        for (const name of ["igv-variant", "igv-spliceai-ref-alt", "igv-spliceai-delta-scores", "igv-pangolin-delta-scores", "igv-gencode-genes"]) {
            // The delta-score checkboxes are forced unchecked in the UI while in position-only mode
            // (see updateControlsForPositionOnlyMode) -- that's not the user's real preference, so use
            // the captured pre-position-only value instead of the live (forced) DOM state to avoid
            // persisting it to localStorage and silently overwriting what the user actually chose.
            tracksToShow[name] = (wasPositionOnly && name in deltaTrackCheckedBeforePositionOnly)
                ? deltaTrackCheckedBeforePositionOnly[name]
                : $(`input[name='${name}']`).prop("checked")
        }
        for (const name of ["igv-100-mer-mappability", "igv-segdups", "igv-mane-genes"]) {
            // these tracks are not available for hg37
            $(`input[name='${name}']`).prop("checked", $(`input[name='${name}']`).prop("checked") && genomeVersion != "37")
            $(`input[name='${name}']`).prop("disabled", genomeVersion == "37")

            tracksToShow[name] = $(`input[name='${name}']`).prop("checked")
        }
        for (const minScore of [0.5, 0.2]) {   //0.2,  hide the >= 0.2 tracks for now
            for (const splicePredictionType of ["loss", "gain"]) {
                const name = `igv-spliceai-precomputed-${splicePredictionType}-${minScore}`

                // these tracks are not available for hg19
                $(`input[name='${name}']`).prop("checked", $(`input[name='${name}']`).prop("checked") && genomeVersion != "37")
                $(`input[name='${name}']`).prop("disabled", genomeVersion == "37")

                tracksToShow[name] = $(`input[name='${name}']`).prop("checked")
            }
        }

        tracksToShow[`igv-spliceai-precomputed-score-genes`] = $(`input[name='igv-spliceai-precomputed-score-genes']`).prop("checked")

        for (const tissue of ["blood", "fibroblasts", "muscle", "lymphocytes", "brain-cortex"]) {
            // these tracks are not available for hg19
            $(`input[name='igv-gtex-${tissue}']`).prop("checked", $(`input[name='igv-gtex-${tissue}']`).prop("checked") && genomeVersion != "37")
            $(`input[name='igv-gtex-${tissue}']`).prop("disabled", genomeVersion == "37")
            $(`input[name='igv-gtex-${tissue}-all']`).prop("checked", $(`input[name='igv-gtex-${tissue}-all']`).prop("checked") && genomeVersion != "37")
            $(`input[name='igv-gtex-${tissue}-all']`).prop("disabled", genomeVersion == "37")

            tracksToShow[`igv-gtex-${tissue}`] = $(`input[name='igv-gtex-${tissue}']`).prop("checked")
            tracksToShow[`igv-gtex-${tissue}-all`] = $(`input[name='igv-gtex-${tissue}-all']`).prop("checked")
        }
        //console.log("Set local storage tracksToShow", tracksToShow)
        localStorage.setItem("tracksToShow", JSON.stringify(tracksToShow))
    }
    
    return tracksToShow
}


const generateIgvConfig = (spliceaiResponseJson, pangolinResponseJson, genomeVersion) => {
    /* Generates an igv.js config json objects based on the predicted scores from SpliceAI and/or Pangolin
    *
    * Args:
    *   allNonZeroScoresFromSpliceAI (array): an array of acceptor/donor loss/gain scores from SpliceAI
    *   allNonZeroScoresFromPangolin (array): an array of acceptor/donor loss/gain scores from Pangolin
    *   genomeVersion (string): "37" or "38"
    *
    * Return:
    *   object: an igv.js config json object
    */

    const apiResponseJson = spliceaiResponseJson || pangolinResponseJson
    let chrom = apiResponseJson.chrom
    chrom = `chr${chrom.replace('chr', '')}`
    const variantPos = apiResponseJson.pos
    const variantRef = apiResponseJson.ref
    const variantAlt = apiResponseJson.alt
    // REF-only (position-only) responses have no ref/alt -- no delta tracks (nothing to compute a
    // delta against), and the SpliceAI REF track's description below drops all mentions of an ALT
    // sequence. The Variant track still renders, as a synthetic 1bp block at the queried position.
    const isPositionOnly = !!apiResponseJson.isPositionOnly
    const variantOrPositionLabel = isPositionOnly
        ? `${chrom}:${variantPos}`
        : `${chrom}:${variantPos} ${variantRef}>${variantAlt}`

    const tracksToShow = updateVisualizationCheckboxes(false, genomeVersion)

    // log event. mask is absent from REF-only (position-only) responses -- omit it rather than
    // logging the literal string "undefined".
    const maskLogArg = isPositionOnly ? "" : `&mask=${encodeURIComponent(apiResponseJson.mask)}`
    makeRequest(`${baseApiUrl['pangolin-37']}/log/show_igv?details=${encodeURIComponent(JSON.stringify(tracksToShow))}&hg=${encodeURIComponent(genomeVersion)}&distance=${encodeURIComponent(apiResponseJson.distance)}${maskLogArg}&variant=${encodeURIComponent(apiResponseJson.variant)}`)

    let minPos = null
    let maxPos = null
    for (const apiResponse of [spliceaiResponseJson, pangolinResponseJson]) {
        if (!apiResponse) {
            continue
        }
        if (!apiResponse.allNonZeroScores) {
            continue
        }
        for (const scores of apiResponse.allNonZeroScores) {
            scores["chr"] = chrom
            scores["start"] = scores["pos"]
            scores["end"] = scores["pos"]
            minPos = (minPos === null) ? scores["pos"] : Math.min(minPos, scores["pos"])
            maxPos = (maxPos === null) ? scores["pos"] : Math.max(maxPos, scores["pos"])
        }
    }
    // Fall back to the variant position if both responses had no non-zero
    // scores (empty array bypasses the apiResponse.allNonZeroScores guard).
    if (minPos === null || maxPos === null) {
        minPos = variantPos
        maxPos = variantPos
    }

    // specify IGV tracks and the data to display in them
    const tracks = []

    tracks.push({
        name: "Refseq",
        format: "refgene",
        url: genomeVersion == "38" ?
            "https://hgdownload.soe.ucsc.edu/goldenPath/hg38/database/ncbiRefSeq.txt.gz" :
            "https://hgdownload.soe.ucsc.edu/goldenPath/hg19/database/ncbiRefSeq.txt.gz",
        indexed: false,
        infoURL: "https://www.ncbi.nlm.nih.gov/gene/?term=$$",
        height: 100,
    })

    if (tracksToShow["igv-variant"]) {
        // Real variant: for deletions, skip the anchor base by adding 1 to start.
        // Position-only: no REF/ALT is known, so render a synthetic 1bp block spanning just the
        // queried reference base instead of a variant.
        const variantFeature = isPositionOnly
            ? {
                chr: chrom,   //see createVCFVariant function in the igv.js repo for the allowed fields
                pos: variantPos,
                start: variantPos - 1,
                end: variantPos,
                referenceAllele: "N",
                alternateBases: "",
                names: ".", // id in VCF
                info: {
                    variant: `${chrom}:${variantPos}`,
                }
            }
            : {
                chr: chrom,
                pos: variantPos,
                start: variantRef.length > variantAlt.length ? variantPos : variantPos - 1,
                end: variantPos + variantRef.length - 1,
                referenceAllele: variantRef,
                alternateBases: variantAlt,
                names: ".", // id in VCF
                info: {
                    variant: `${chrom}-${variantPos}-${variantRef}-${variantAlt}`,
                }
            }
        tracks.push({
            name: isPositionOnly ? "Ref. position" : "Variant",
            type: "vcf",
            description: isPositionOnly
                ? `This track shows the queried reference position <b>${chrom}:${variantPos}</b> (no ALT allele was specified)`
                : `This track shows the location of the <b>${chrom}:${variantPos} ${variantRef}>${variantAlt}</b> variant`,
            height: 30,
            features: [variantFeature],
        })
    }

    if (spliceaiResponseJson) {
        if (tracksToShow["igv-spliceai-ref-alt"]) {
            tracks.push({
                name: isPositionOnly ? `SpliceAI REF` : `SpliceAI REF/ALT`,
                description: isPositionOnly ? `This track shows SpliceAI's predicted acceptor/donor probabilities for the
                                <span style="color:#0000B4"><b>reference sequence</b></span> (no ALT allele was specified). <br />
                                An <b>A</b> (acceptor) or <b>D</b> (donor) symbol is shown where SpliceAI predicts a splice donor or acceptor with score ≥ 0.01. <br/>
                                These predictions are based on the pre-mRNA sequence for transcript <br />
                                <b>${spliceaiResponseJson.allNonZeroScoresTranscriptId}</b> (${spliceaiResponseJson.allNonZeroScoresStrand == '-' ? 'minus' : 'plus'} strand)
                                within a +/- ${spliceaiResponseJson.distance}bp window around <b>${variantOrPositionLabel}</b>.` : `This track shows SpliceAI scores for the
                                <span style="color:#0000B4"><b>reference sequence</b></span> (without the variant) and the
                                <span style="color:#05d0d2"><b>alternate sequence</b></span> (with the variant). <br />
                                An <b>A</b> (acceptor) or <b>D</b> (donor) symbol is shown where SpliceAI predicts there to be a splice donor or acceptor with score ≥ 0.01. <br/>
                                These symbols are shown up-side-down when the score for the alternate sequence is lower than the score for the reference sequence.
                                Numberical labels represent scores for the reference sequence. These predictions are based on the pre-mRNA sequence for transcript <br />
                                <b>${spliceaiResponseJson.allNonZeroScoresTranscriptId}</b> (${spliceaiResponseJson.allNonZeroScoresStrand == '-' ? 'minus' : 'plus'} strand)
                                within a +/- ${spliceaiResponseJson.distance}bp window around <b>${variantOrPositionLabel}</b>.`,
                height: 100,
                rawOrDelta: "raw",
                tool: "SpliceAI",
                type: "spliceprediction",
                features: spliceaiResponseJson.allNonZeroScores || [],
                strand: spliceaiResponseJson.allNonZeroScoresStrand || "+",
            })
        }
        if (tracksToShow["igv-spliceai-delta-scores"] && !isPositionOnly) {
            tracks.push({
                name: `SpliceAI Δ`,
                description: `This track shows <b>A</b> (acceptor) and <b>D</b> (donor) symbols at positions where SpliceAI predicts a delta score ≥ 0.01. <br/>
                                Vertical lines are <b style="color:#FF0000">red</b> for delta scores ≥ 0.8,
                                <b style="color:#FFCB1F">yellow</b> for delta scores ≥ 0.5, and
                                <b style="color:#1fb839">green</b> for delta scores ≥ 0.2<br />
                                These predictions are based on the pre-mRNA sequence for transcript
                                <b>${spliceaiResponseJson.allNonZeroScoresTranscriptId}</b> (${spliceaiResponseJson.allNonZeroScoresStrand == '-' ? 'minus' : 'plus'} strand)<br />
                                within a +/- ${spliceaiResponseJson.distance}bp window around <b>${chrom}:${variantPos} ${variantRef}>${variantAlt}</b>.`,
                height: 200,
                rawOrDelta: "delta",
                tool: "SpliceAI",
                type: "spliceprediction",
                features: spliceaiResponseJson.allNonZeroScores || [],
                strand: spliceaiResponseJson.allNonZeroScoresStrand || "+",
            })
        }
    }

    if (pangolinResponseJson) {
        if (tracksToShow["igv-pangolin-delta-scores"] && !isPositionOnly) {

            tracks.push({
                name: `Pangolin Δ`,
                description: `This track shows a <b>P</b> at positions where Pangolin predicts a delta score ≥ 0.01. <br/>
                                Vertical lines are <b style="color:#FF0000">red</b> for delta scores ≥ 0.8,
                                <b style="color:#FFCB1F">yellow</b> for delta scores ≥ 0.5, and
                                <b style="color:#1fb839">green</b> for delta scores ≥ 0.2<br />
                                These predictions are based on the pre-mRNA sequence for transcript
                                <b>${pangolinResponseJson.allNonZeroScoresTranscriptId}</b> (${pangolinResponseJson.allNonZeroScoresStrand == '-' ? 'minus' : 'plus'} strand)<br />
                                within a +/- ${pangolinResponseJson.distance}bp window around <b>${chrom}:${variantPos} ${variantRef}>${variantAlt}</b>.`,
                height: 200,
                rawOrDelta: "delta",
                tool: "Pangolin",
                type: "spliceprediction",
                features: pangolinResponseJson.allNonZeroScores || [],
                strand: pangolinResponseJson.allNonZeroScoresStrand || "+",
            })
        }
    }

    if (tracksToShow["igv-gencode-genes"]) {
        const gencodeTrackPath = `https://storage.googleapis.com/tgg-viewer/ref/GRCh${genomeVersion}/gencode_${GENCODE_VERSION}/gencode.${GENCODE_VERSION}.GRCh${genomeVersion}.sorted.txt.gz`

        tracks.push({
            name: `Gencode ${GENCODE_VERSION}`,
            format: 'refgene',
            url: gencodeTrackPath,
            indexURL: `${gencodeTrackPath}.tbi`,
            indexed: true,
            searchable: true,
            height: 350,
            visibilityWindow: -1,
            order: 1000001,
            displayMode: 'EXPANDED',
            color: 'rgb(76,171,225)',
        })
    }

    if (tracksToShow["igv-mane-genes"]) {
        tracks.push({
            name: "MANE v1.4",
            format: "gtf",
            url: "https://storage.googleapis.com/tgg-viewer/ref/GRCh38/MANE_v1_4/MANE.GRCh38.v1.4.ensembl_genomic.sorted.gtf.gz",
            indexURL: "https://storage.googleapis.com/tgg-viewer/ref/GRCh38/MANE_v1_4/MANE.GRCh38.v1.4.ensembl_genomic.sorted.gtf.gz.tbi",
            height: 100,
        })
    }

    if (tracksToShow["igv-spliceai-precomputed-score-genes"]) {
        const precomputedScoresGeneTrackPath = `https://storage.googleapis.com/tgg-viewer/ref/GRCh${genomeVersion}/gencode_v24/gencode_v24_annotations.grch${genomeVersion}.bed.gz`

        tracks.push({
            name: `Genes used for precomputed scores`,
            //format: 'bed',
            url: `${precomputedScoresGeneTrackPath}?`,
            indexURL: `${precomputedScoresGeneTrackPath}.tbi?`,
            indexed: true,
            searchable: true,
            height: 350,
            visibilityWindow: -1,
            displayMode: 'EXPANDED',
            color: 'rgb(76,171,225)',
        })
    }


    if (genomeVersion == "38") {
        for (const minScore of [0.5, 0.2]) {
            for (const splicePredictionType of ["loss", "gain"]) {
                if (tracksToShow[`igv-spliceai-precomputed-${splicePredictionType}-${minScore}`]) {
                    tracks.push(
                        {
                            name: `SpliceAI: A or D ${splicePredictionType} ≥ ${minScore}`,
                            description: `This track visualizes Illumina's precomputed SpliceAI score tables for SNVs and small INDELs.<br/>
                                    Each genomic location of an SNV or INDEL variant with a SpliceAI &#916; score ≥ ${minScore} is shown as the origin of an arrow.<br />
                                    The arrow points to the location where that variant would likely cause acceptor or donor ${splicePredictionType}.
                                    Clicking on the arrow displays additional details.`,
                            type: "spliceJunctions",
                            height: 100,
                            url: `https://storage.googleapis.com/tgg-viewer/ref/GRCh38/spliceai/spliceai_scores.raw.snps_and_indels.hg38.filtered.sorted.score_${minScore}.splice_${splicePredictionType}.bed.gz`,
                            indexURL: `https://storage.googleapis.com/tgg-viewer/ref/GRCh38/spliceai/spliceai_scores.raw.snps_and_indels.hg38.filtered.sorted.score_${minScore}.splice_${splicePredictionType}.bed.gz.tbi`,
                        }
                    )
                }
            }
        }


        for (const [filenamePrefix, tissue, sampleCount] of [
            ["GTEX_blood.755_samples", "blood", 755],
            ["GTEX_fibs.504_samples", "fibroblasts", 504],
            ["GTEX_muscle.803_samples", "muscle", 803],
            ["GTEX_lymphocytes.174_samples", "lymphocytes", 174],
            ["GTEX_brain_cortex.255_samples", "brain-cortex", 255],
            //["GTEX_frontal_cortex.209_samples", "frontal cortex", 803],
        ]) {
            for (const normalized of [true, false]) {
                if (!tracksToShow[`igv-gtex-${tissue}${normalized ? '' : '-all'}`]) {
                    continue
                }

                const filenameSuffix = normalized ? ".normalized" : ""
                tracks.push({
                    name: `GTEx ${tissue}: ${normalized ? 'per-sample average' : `summed over all ${sampleCount} samples`}`,
                    description: `This track shows the combined splice junctions from all ${sampleCount} ${tissue} samples available in GTEx v8.
                                    Splice junctions are labeled with the total number of RNA-seq reads that supported the junction, summed across the ${sampleCount} samples${normalized ? ' and divided by ' + sampleCount : ''}.
                                    The coverage track shows the total number of RNA-seq reads that overlap each position, summed across all samples${normalized ? ' and divided by ' + sampleCount : ''}.`,
                    type: "merged",
                    height: 100,
                    tracks: [{
                        type: "wig",
                        format: "bigwig",
                        url: `https://storage.googleapis.com/tgg-viewer/ref/GRCh38/gtex_v8/${filenamePrefix}${filenameSuffix}.bigWig`,
                    }, {
                        type: 'spliceJunctions',
                        format: 'bed',
                        minJunctionEndsVisible: 1,
                        colorBy: 'strand',
                        minTotalReads: 3,
                        url: `https://storage.googleapis.com/tgg-viewer/ref/GRCh38/gtex_v8/${filenamePrefix}${filenameSuffix}.junctions.bed.gz`,
                        indexURL: `https://storage.googleapis.com/tgg-viewer/ref/GRCh38/gtex_v8/${filenamePrefix}${filenameSuffix}.junctions.bed.gz.tbi`,
                    }],
                })
            }
        }

        if (tracksToShow["igv-100-mer-mappability"]) {
            tracks.push({
                name: "100-mer mappability",
                description: "100bp k-mer mappability track from UCSC. Lower values indicate regions that are not unique",
                type: "wig",
                format: "bigwig",
                url: "https://storage.googleapis.com/tgg-viewer/ref/GRCh38/mappability/GRCh38_no_alt_analysis_set_GCA_000001405.15-k100_m2.bw",
                height: 100,
            })
        }

        if (tracksToShow["igv-segdups"]) {
            tracks.push({
                name: "SegDups",
                description: "Segmental duplications track from UCSC",
                format: "gtf",
                url: "https://storage.googleapis.com/tgg-viewer/ref/GRCh38/segdups/segdups.gtf.gz",
                indexURL: "https://storage.googleapis.com/tgg-viewer/ref/GRCh38/segdups/segdups.gtf.gz.tbi",
                height: 100,
            })
        }
    }

    let locusMargin = maxPos - minPos < 200 ? 15 : 50

    // igv.js reference genome specs are copied from https://igv.org/genomes/genomes.json
    // These must be specified explicitly rather than just setting the reference to "hg19" or "hg38" so that
    // the RefSeq gene track can be the first track (as described in https://github.com/igvteam/igv.js/issues/1518)
    // Use a custom id for hg19 so igv.js does not merge the built-in hg19 genome (whose cytoband and
    // other URLs point at retired S3 paths that return 404).
    let reference = genomeVersion == "37" ? {
        "id": "GRCh37",
        "name": "Human (GRCh37/hg19)",
        "fastaURL": "https://igv.org/genomes/data/hg19/hg19.fasta",
        "indexURL": "https://igv.org/genomes/data/hg19/hg19.fasta.fai",
        "cytobandURL": "https://hgdownload.soe.ucsc.edu/goldenPath/hg19/database/cytoBand.txt.gz",
        "aliasURL": "https://igv.org/genomes/data/hg19/hg19_alias.tab",
        "chromosomeOrder": "chr1, chr2, chr3, chr4, chr5, chr6, chr7, chr8, chr9, chr10, chr11, chr12, chr13, chr14, chr15, chr16, chr17, chr18, chr19, chr20, chr21, chr22, chrX, chrY",
        "tracks": tracks,
    } : {
        "id": "hg38",
        "name": "Human (GRCh38/hg38)",
        "fastaURL": "https://igv.org/genomes/data/hg38/hg38.fa",
        "indexURL": "https://igv.org/genomes/data/hg38/hg38.fa.fai",
        "cytobandURL": "https://s3.amazonaws.com/igv.org.genomes/hg38/annotations/cytoBandIdeo.txt.gz",
        "aliasURL": "https://s3.amazonaws.com/igv.org.genomes/hg38/hg38_alias.tab",
        "chromosomeOrder": "chr1, chr2, chr3, chr4, chr5, chr6, chr7, chr8, chr9, chr10, chr11, chr12, chr13, chr14, chr15, chr16, chr17, chr18, chr19, chr20, chr21, chr22, chrX, chrY",
        "tracks": tracks,
    }

    return {
        reference: reference,
        showCursorTrackingGuide: true,
        locus: `${chrom}:${minPos - locusMargin}-${maxPos + locusMargin}`,
    }
}

const readFileAsText = (file) => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error("Could not read file"))
    r.readAsText(file)
})

const sanitizePastedText = (text) =>
    text
        .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
        .replace(/\u00A0/g, " ")
        .replace(/[\u2028\u2029]/g, "\n")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")

const parseVariantsFromText = (text) => {
    const lines = sanitizePastedText(text)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))

    const variants = []
    for (let i = 0; i < lines.length; ) {
        const line = lines[i]

        if (VARIANT_RE.test(line)) {
            variants.push(line)
            i++
            continue
        }

        if (
            LOC_ONLY_RE.test(line) &&
            i + 2 < lines.length &&
            ALLELE_RE.test(lines[i + 1]) &&
            ALLELE_RE.test(lines[i + 2])
        ) {
            variants.push(`${line}:${lines[i + 1]}:${lines[i + 2]}`)
            i += 3
            continue
        }

        variants.push(line)
        i++
    }
    return variants
}

const normalizeVariantsText = (text) => parseVariantsFromText(text).join("\n")

const parseVariantsFromVCF = (content) => {
    const variants = []
    for (const line of content.split(/\r?\n/)) {
        if (!line.trim() || line.startsWith("#")) continue
        const cols = line.split("\t")
        if (cols.length < 5) continue
        const chrom = cols[0].replace(/^chr/i, "")
        const pos = cols[1]
        const ref = cols[3]
        const altField = cols[4]
        if (ref === "." || altField === "." || !ref || !altField) continue
        if (ref.includes("<") || altField.includes("<")) continue
        const alt = altField.split(",")[0].trim()
        if (!alt) continue
        variants.push(`${chrom}-${pos}-${ref}-${alt}`)
    }
    return variants
}

const getVcfFileInput = () => document.getElementById("batch-vcf-file")

const vcfFileIsSelected = () => {
    const fileInput = getVcfFileInput()
    return !!(fileInput && fileInput.files && fileInput.files.length > 0)
}

const updateVcfFileUI = () => {
    const hasFile = vcfFileIsSelected()
    $("#clear-vcf-file-btn").toggle(hasFile)
    if (hasFile) {
        $("#batch-vcf-filename").text(getVcfFileInput().files[0].name).show()
    } else {
        $("#batch-vcf-filename").hide().text("")
    }
}

/** Clear the VCF file input so textarea variants are used on the next submit. */
const clearVcfFileInput = () => {
    const fileInput = getVcfFileInput()
    if (fileInput) {
        fileInput.value = ""
    }
    updateVcfFileUI()
}

const resolveVariantListFromInputs = async () => {
    const fileInput = getVcfFileInput()
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0]
        const name = file.name.toLowerCase()
        if (name.endsWith(".vcf.gz")) {
            throw new Error("Please upload a plain-text .vcf file (gzip is not supported in the browser).")
        }
        const text = await readFileAsText(file)
        if (name.endsWith(".vcf")) {
            return parseVariantsFromVCF(text)
        }
        return parseVariantsFromText(text)
    }
    const text = $("#variants-textarea").val().trim()
    if (text) {
        const lines = parseVariantsFromText(text)
        if (lines.length) return lines
    }
    return []
}

const initResultTablePopups = () => {
    $(".question, .exclamation, .score-table").popup({
        "on": "click",
        "lastResort": "bottom left",
    })
    $(".question").css({"color": "#666666", "cursor": "pointer"})
    $(".exclamation").css({"cursor": "pointer"})
    $(".score-table").css({"color": "#000080", "cursor": "pointer"})
    // hover rather than click, so the disabled icons can explain why they're disabled
    $(".per-position-table-icon").popup({"on": "hover", "lastResort": "bottom left"})
    $(".ui.modal").modal()
}

const refreshBatchNavControls = () => {
    const n = batchVariantResults.length
    $("#batch-prev-btn").prop("disabled", currentBatchIndex <= 0)
    $("#batch-next-btn").prop("disabled", currentBatchIndex >= n - 1 || n === 0)
}

const displayBatchVariantAtIndex = async (idx) => {
    if (!batchVariantResults.length || idx < 0 || idx >= batchVariantResults.length) return
    if (!lastBatchFormOptions) return

    currentBatchIndex = idx
    const o = lastBatchFormOptions
    const entry = batchVariantResults[idx]

    $("#batch-counter").text(`Variant ${idx + 1} of ${batchVariantResults.length}`)
    $("#batch-variant-select").val(String(idx))
    refreshBatchNavControls()

    $("#error-box").html("")
    $("#notes-box").html("").hide()
    // The modal belongs to the entry being navigated away from, and its rows are for that entry's
    // transcript, so close it rather than leaving it over the newly displayed results.
    dismissPerPositionModal()
    removeInsertedBasesModals()

    if (entry.normalizeError) {
        showError(entry.normalizeError)
        $("#spliceai-table, #pangolin-table, #sai10k-table, #transcript-button-table, #other-predictors-table").hide()
        $("#response-box").show()
        return
    }

    const variant = entry.rawVariant
    const normalizedVariant = entry.normalizedVariant
    const variantConsequence = entry.consequence
    const isPositionOnly = Boolean(entry.isPositionOnly)

    // A batch can mix full variants with bare positions, so the controls follow whichever entry is
    // on screen.
    updateControlsForPositionOnlyMode(isPositionOnly)

    for (const warning of (entry.warnings || [])) {
        showNote(`Note: ${warning}`)
    }

    lastSpliceaiResponseJson = entry.spliceaiJson
    lastPangolinResponseJson = entry.pangolinJson
    lastGenomeVersion = o.genomeVersion

    // Position-only rows never render the REF/ALT toggle columns (no ALT to show).
    $(".ref-score-column, .alt-score-column").toggle(!isPositionOnly && o.showRefAltColumns == "1")

    if (!entry.spliceaiError && entry.spliceaiJson) {
        renderSplicingResultsFromApiJson(entry.spliceaiJson, normalizedVariant, variantConsequence, "SpliceAI", variant, o.genomeVersion, o.basicOrComprehensive, o.maxDistance, o.mask, o.showRefAltColumns, isPositionOnly)
        if (entry.spliceaiJson.sai10kPredictionsError) {
            showError(`SAI-10k predictions failed: ${entry.spliceaiJson.sai10kPredictionsError}`)
        }
        $("#spliceai-table, #transcript-button-table").show()
    } else {
        if (entry.spliceaiError) showError(entry.spliceaiError)
        $("#spliceai-table, #transcript-button-table").hide()
    }

    // SAI-10k-calc predictions require an ALT allele, so the section stays hidden in REF-only mode.
    if (isPositionOnly) {
        $("#sai10k-table").hide()
    } else {
        generateSai10kTable(entry.spliceaiError ? null : entry.spliceaiJson, o.genomeVersion)
    }

    if (!entry.pangolinError && entry.pangolinJson) {
        renderSplicingResultsFromApiJson(entry.pangolinJson, normalizedVariant, variantConsequence, "Pangolin", variant, o.genomeVersion, o.basicOrComprehensive, o.maxDistance, o.mask, o.showRefAltColumns, isPositionOnly)
        $("#pangolin-table").show()
    } else {
        if (entry.pangolinError) showError(entry.pangolinError)
        $("#pangolin-table").hide()
    }

    // 'Other scores' needs an ALT allele too.
    if (isPositionOnly) {
        $("#other-predictors-table").hide()
    } else {
        // Caught rather than thrown: this table is supplementary, and letting it reject here would
        // leave the tables that did render hidden behind an unshown #response-box.
        await generateOtherPredictorsTable(entry.lookupVariant || normalizedVariant, variantConsequence, variant, o.genomeVersion)
            .catch((e) => console.error("Could not build the other scores table:", e))
        $("#other-predictors-table").show()
    }

    $("#response-box").show()
    initResultTablePopups()

    if (lastSpliceaiResponseJson != null || lastPangolinResponseJson != null) {
        $("#igv-table").show()
        $("#igv-div").hide()
        $("#show-igv-button").text("Show")
    }

    window.location.hash = "#" + $.param({
        variant: variant,
        hg: o.genomeVersion,
        bc: o.basicOrComprehensive,
        distance: o.maxDistance,
        mask: o.mask,
        ra: o.showRefAltColumns,
    })
}

const updateBatchAnalysisProgressUi = (indexZeroBased, total, rawVariant) => {
    const n = total
    const i = indexZeroBased
    const shortPreview =
        rawVariant.length > 80 ? `${rawVariant.slice(0, 77)}…` : rawVariant
    const $label = $("#batch-analysis-progress-label").empty()
    $label.append(document.createTextNode("Analyzing variant "))
    $label.append($("<strong>").text(`${i + 1}`))
    $label.append(document.createTextNode(" of "))
    $label.append($("<strong>").text(`${n}`))
    $label.append(document.createTextNode(" — "))
    $label.append($("<strong>").text(`${i}`))
    $label.append(document.createTextNode(` of ${n} already analyzed`))
    $label.append(
        $("<div>")
            .addClass("batch-analysis-variant-preview")
            .css({ fontSize: "0.9em", color: "#666", marginTop: "5px" })
            .text(shortPreview)
    )
}

const runBatchVariantSubmit = async (variants, formOptions) => {
    lastBatchFormOptions = formOptions
    batchVariantResults = []
    $("#batch-progress").text("")
    $("#batch-analysis-progress-wrap").show()
    $("#batch-analysis-progress-fill").css("width", "0%")

    const n = variants.length

    for (let i = 0; i < n; i++) {
        const rawVariant = variants[i]
        updateBatchAnalysisProgressUi(i, n, rawVariant)
        const entry = {
            rawVariant,
            normalizedVariant: null,
            consequence: null,
            // The left-aligned spelling GeneBe reports, which is what gnomAD, myvariant.info and the
            // precomputed score tables are indexed by (see consequencesFrom). null on hg19 and
            // whenever no consequence source answered.
            lookupVariant: null,
            warnings: null,
            isPositionOnly: false,
            spliceaiJson: null,
            pangolinJson: null,
            spliceaiError: null,
            pangolinError: null,
            normalizeError: null,
        }
        // A bare chrom+pos line asks for REF-only scores, so it needs no HGVS/VCF normalization --
        // just canonical "chrom-pos" tokens for the API calls below.
        const positionOnlyMatch = rawVariant.match(POSITION_ONLY_RE)
        let consequencesPromise = null
        if (positionOnlyMatch) {
            entry.isPositionOnly = true
            entry.normalizedVariant =
                `${positionOnlyMatch[2].toUpperCase()}-${parseInt(positionOnlyMatch[3].replace(/,/g, ""))}`
        } else {
            try {
                const norm = await normalizeVariant(rawVariant, formOptions.genomeVersion)
                entry.normalizedVariant = norm.variant
                entry.warnings = norm.warnings || null
                // Still running: the scoring requests below don't need it, so it is awaited after
                // they have been sent rather than before.
                consequencesPromise = norm.consequencesPromise
            } catch (e) {
                entry.normalizeError = e.message
                batchVariantResults.push(entry)
                $("#batch-analysis-progress-fill").css("width", `${((i + 1) / n) * 100}%`)
                $("#batch-analysis-progress-label").html(
                    `Recorded variant <strong>${i + 1}</strong> of <strong>${n}</strong> (normalization failed) — <strong>${i + 1}</strong> of ${n} processed`
                )
                continue
            }
        }

        const [spliceaiSettled, pangolinSettled, consequencesSettled] = await Promise.allSettled([
            fetchSplicingToolJson(entry.normalizedVariant, "SpliceAI", rawVariant, formOptions.genomeVersion, formOptions.basicOrComprehensive, formOptions.maxDistance, formOptions.mask, entry.isPositionOnly),
            fetchSplicingToolJson(entry.normalizedVariant, "Pangolin", rawVariant, formOptions.genomeVersion, formOptions.basicOrComprehensive, formOptions.maxDistance, formOptions.mask, entry.isPositionOnly),
            consequencesPromise || Promise.resolve(null),
        ])

        if (consequencesSettled.status === "fulfilled" && consequencesSettled.value) {
            entry.consequence = consequencesSettled.value.consequence
            entry.lookupVariant = consequencesSettled.value.normalizedVariant || null
        }

        if (spliceaiSettled.status === "fulfilled") {
            entry.spliceaiJson = spliceaiSettled.value
        } else {
            entry.spliceaiError = spliceaiSettled.reason.message || String(spliceaiSettled.reason)
        }
        if (pangolinSettled.status === "fulfilled") {
            entry.pangolinJson = pangolinSettled.value
        } else {
            entry.pangolinError = pangolinSettled.reason.message || String(pangolinSettled.reason)
        }

        batchVariantResults.push(entry)
        $("#batch-analysis-progress-fill").css("width", `${((i + 1) / n) * 100}%`)
        $("#batch-analysis-progress-label").html(
            `Analyzed <strong>${i + 1}</strong> of <strong>${n}</strong> variants`
        )
    }

    $("#batch-analysis-progress-wrap").hide()
    $("#batch-analysis-progress-fill").css("width", "0%")
    $("#batch-analysis-progress-label").empty()
    $("#batch-progress").text("")
    $("#batch-nav").show()
    const $sel = $("#batch-variant-select").empty()
    batchVariantResults.forEach((e, i) => {
        const short = e.rawVariant.length > 72 ? `${e.rawVariant.slice(0, 69)}…` : e.rawVariant
        const label = e.normalizeError ? `${short} (failed)` : short
        $sel.append($("<option/>").attr("value", i).text(`${i + 1}. ${label}`))
    })

    await displayBatchVariantAtIndex(0)
}

const runSingleVariantSubmit = async (variant, formOptions) => {
    const genomeVersion = formOptions.genomeVersion
    const basicOrComprehensive = formOptions.basicOrComprehensive
    const maxDistance = formOptions.maxDistance
    const mask = formOptions.mask
    const showRefAltColumns = formOptions.showRefAltColumns
    const isPositionOnly = Boolean(formOptions.isPositionOnly)

    try {
        let normalizedVariant, resolvedVariant
        let consequencesPromise = Promise.resolve(
            {'consequence': null, 'consequencesByTranscriptId': null, 'normalizedVariant': null})
        if (isPositionOnly) {
            // No ref/alt to resolve via GeneBe or Ensembl -- a bare position needs no HGVS/VCF
            // normalization, just canonical "chrom-pos" tokens for the API calls below.
            const positionOnlyMatch = variant.match(POSITION_ONLY_RE)
            normalizedVariant =
                `${positionOnlyMatch[2].toUpperCase()}-${parseInt(positionOnlyMatch[3].replace(/,/g, ""))}`
        } else {
            resolvedVariant = await normalizeVariant(variant, genomeVersion, showProgress)
            normalizedVariant = resolvedVariant.variant
            // Still running. The scoring requests below don't wait on it: the consequence is only
            // used by this page, so waiting for it would delay every search for nothing.
            consequencesPromise = resolvedVariant.consequencesPromise
        }
        clearProgress()

        // Notes about how the input was interpreted, eg. which allele a dbSNP id resolved to
        for (const warning of ((resolvedVariant && resolvedVariant.warnings) || [])) {
            showNote(`Note: ${warning}`)
        }

        // The consequence isn't sent with these requests: the backends have no use for it, and on
        // most searches it isn't known yet anyway. It is fetched alongside them rather than ahead of
        // them, and the tables are rendered once both have answered, so a slow consequence lookup no
        // longer holds up the scoring calls and a failed one can no longer fail the search
        // (consequencesPromise never rejects).
        showProgress("Computing SpliceAI and Pangolin scores...")
        let [spliceaiResponseJson, pangolinResponseJson, consequences] = await Promise.all([
            fetchSplicingToolJson(normalizedVariant, "SpliceAI", variant, genomeVersion, basicOrComprehensive, maxDistance, mask, isPositionOnly)
                .catch(e => ({'error': e.message, 'inputError': e.inputError})),
            fetchSplicingToolJson(normalizedVariant, "Pangolin", variant, genomeVersion, basicOrComprehensive, maxDistance, mask, isPositionOnly)
                .catch(e => ({'error': e.message, 'inputError': e.inputError})),
            consequencesPromise,
        ])
        clearProgress()

        const variantConsequence = consequences.consequence
        // GeneBe left-aligns indels, and that is the spelling gnomAD, myvariant.info and the
        // precomputed score tables are indexed by, where the services score the trimmed spelling.
        const lookupVariant = consequences.normalizedVariant || normalizedVariant

        // A rejected REF allele isn't one tool failing, it's the variant being wrong, and every
        // backend says so. There are no scores to show, so stop here rather than reporting it twice.
        const inputError = [spliceaiResponseJson, pangolinResponseJson]
            .find((r) => r && r.inputError && r.error)
        if (inputError) {
            showError(`${inputError.error}`)
            $("#response-box, #spliceai-table, #pangolin-table, #sai10k-table, #transcript-button-table").hide()
            return
        }

        if (!spliceaiResponseJson.error) {
            renderSplicingResultsFromApiJson(spliceaiResponseJson, normalizedVariant, variantConsequence, "SpliceAI", variant, genomeVersion, basicOrComprehensive, maxDistance, mask, showRefAltColumns, isPositionOnly)
        }
        if (!pangolinResponseJson.error) {
            renderSplicingResultsFromApiJson(pangolinResponseJson, normalizedVariant, variantConsequence, "Pangolin", variant, genomeVersion, basicOrComprehensive, maxDistance, mask, showRefAltColumns, isPositionOnly)
        }

        // 'Other scores' and the SAI-10k-calc predictions both need an ALT allele.
        if (isPositionOnly) {
            $("#other-predictors-table").hide()
        } else {
            await generateOtherPredictorsTable(lookupVariant, variantConsequence, variant, genomeVersion)
                .catch((e) => console.error("Could not build the other scores table:", e))
            $("#other-predictors-table").show()
        }

        $("#response-box").show()

        initResultTablePopups()

        if (spliceaiResponseJson.error) {
            showError(`${spliceaiResponseJson.error}`)
            spliceaiResponseJson = null
            $("#spliceai-table, #transcript-button-table").hide()
        } else {
            if (spliceaiResponseJson.sai10kPredictionsError) {
                showError(`SAI-10k predictions failed: ${spliceaiResponseJson.sai10kPredictionsError}`)
            }
            $("#spliceai-table, #transcript-button-table").show()
        }

        if (isPositionOnly) {
            $("#sai10k-table").hide()
        } else {
            generateSai10kTable(spliceaiResponseJson, genomeVersion)
        }

        if (pangolinResponseJson.error) {
            showError(`${pangolinResponseJson.error}`)
            pangolinResponseJson = null
            $("#pangolin-table").hide()
        } else {
            $("#pangolin-table").show()
        }

        window.location.hash = "#" + $.param({
            variant: variant,
            hg: genomeVersion,
            bc: basicOrComprehensive,
            distance: maxDistance,
            mask: mask,
            ra: showRefAltColumns,
        })

        lastGenomeVersion = genomeVersion
        lastSpliceaiResponseJson = spliceaiResponseJson
        lastPangolinResponseJson = pangolinResponseJson

        if (spliceaiResponseJson != null || pangolinResponseJson != null) {
            $("#igv-table").show()
            $("#igv-div").hide()
            $("#show-igv-button").text("Show")
        }
    } catch(e) {
        console.error(e)
        showError(e.message)
    } finally {
        // In a finally because the try returns early on a rejected REF allele; without it that path
        // would leave the progress line frozen mid-search.
        clearProgress()
    }
}

const updateIgvBrowser = async (spliceaiResponseJson, pangolinResponseJson, genomeVersion) => {
    if ((spliceaiResponseJson && spliceaiResponseJson.allNonZeroScores) || (
        pangolinResponseJson && pangolinResponseJson.allNonZeroScores)) {
        const igvConfig = generateIgvConfig(spliceaiResponseJson, pangolinResponseJson, genomeVersion)
        if (!window.igvBrowser) {
            // create igv.js browser object if it hasn't been created yet
            window.igvBrowser = await igv.createBrowser(document.getElementById("igv-viewport"), igvConfig)
        } else {
            console.log("Updating igv config to", igvConfig)
            await window.igvBrowser.loadSessionObject(igvConfig)
        }
    }
}


const getFormOptions = () => ({
    genomeVersion: $("input[name='hg']:checked").val().trim(),
    basicOrComprehensive: $("input[name='gencode-gene-set']:checked").val().trim(),
    maxDistance: $("#max-distance-input").val().trim(),
    mask: $(`input[name='mask']`).prop("checked") ? "1" : "0",
    showRefAltColumns: $(`input[name='show-ref-alt']`).prop("checked") ? "1" : "0",
})

const handleSubmit = async () => {
    const formOptions = getFormOptions()
    const genomeVersion = formOptions.genomeVersion

    updateVisualizationCheckboxes(false, genomeVersion)

    transcriptFilterPreference = "main"

    // Tear down any existing IGV browser so the next "Show" click rebuilds
    // it from scratch with only the new variant's tracks.
    if (window.igvBrowser) {
        try { igv.removeBrowser(window.igvBrowser) } catch (e) { console.warn("igv.removeBrowser failed:", e) }
        window.igvBrowser = null
    }
    $("#igv-table, #igv-div").hide()
    $("#show-igv-button").text("Show")

    $("#submit-button").addClass("loading disabled")
    $("#batch-analysis-progress-wrap").hide()
    $("#response-box, #spliceai-table, #pangolin-table, #sai10k-table, #transcript-button-table, #error-box, #notes-box").hide()
    $("#error-box, #notes-box").html("")
    clearProgress()
    // Both are top-level overlays rather than part of #response-box, so the hide list above can't
    // reach them: without this the previous search's table would stay on screen over the new results.
    dismissPerPositionModal()
    removeInsertedBasesModals()

    let variants = []
    try {
        variants = await resolveVariantListFromInputs()
    } catch (e) {
        showError(e.message)
        $("#submit-button").removeClass("loading disabled")
        return
    }

    if (!variants.length) {
        showError("No variants to analyze. Enter one or more variants in the text box (one per line) or upload a plain-text .vcf file.")
        $("#submit-button").removeClass("loading disabled")
        return
    }

    if (variants.length > BATCH_VARIANT_MAX) {
        showError(`Please enter at most ${BATCH_VARIANT_MAX} variants per batch.`)
        $("#submit-button").removeClass("loading disabled")
        return
    }

    if (variants.length === 1) {
        // A bare chrom+pos input (no ref/alt) requests REF-only scores: SpliceAI/Pangolin scores for
        // the reference sequence, with no ALT allele, no delta scores, and no sections that require
        // an ALT (Predicted Splicing Consequences, Other scores).
        formOptions.isPositionOnly = POSITION_ONLY_RE.test(variants[0])
        updateControlsForPositionOnlyMode(formOptions.isPositionOnly)
        // Position-only rows never render the REF/ALT toggle columns (no ALT to show), so keep the
        // header cells hidden regardless of the checkbox in that mode.
        $(".ref-score-column, .alt-score-column").toggle(!formOptions.isPositionOnly && formOptions.showRefAltColumns == "1")

        $("#batch-nav").hide()
        batchVariantResults = []
        lastBatchFormOptions = null
        $("#batch-progress").text("")
        await runSingleVariantSubmit(variants[0], formOptions)
        $("#submit-button").removeClass("loading disabled")
        clearProgress()
        return
    }

    // A batch can mix full variants with bare positions, so the mode is applied per entry as it is
    // displayed (see displayBatchVariantAtIndex) rather than once for the whole submit.
    $(".ref-score-column, .alt-score-column").toggle(formOptions.showRefAltColumns == "1")

    await runBatchVariantSubmit(variants, formOptions)
    $("#submit-button").removeClass("loading disabled")
}

const applyUrlSettingsToFormElements = () => {
    // get optional settings from the url and update form settings
    let hgFromUrl = $.urlParam('hg')
    if (hgFromUrl == "19") {
        hgFromUrl = "37"
    }
    if (hgFromUrl && (hgFromUrl == "38" || hgFromUrl == "37")) {
        $(`input[name='hg'][value='${hgFromUrl}']`).prop("checked", true)
    }

    const bcFromUrl = $.urlParam('bc')
    if (bcFromUrl && (bcFromUrl == "basic" || bcFromUrl == "comprehensive")) {
        $(`input[name='gencode-gene-set'][value='${bcFromUrl}']`).prop("checked", true)
    }

    const maxDistanceFromUrl = $.urlParam('distance')
    if (maxDistanceFromUrl) {
        $("#max-distance-input").val(maxDistanceFromUrl)
    }

    const maskFromUrl = $.urlParam('mask')
    if (maskFromUrl) {
        $(`input[name='mask']`).prop("checked", maskFromUrl == "1")
    }

    const showRefAltColumnsFromUrl = $.urlParam('ra')
    if (showRefAltColumnsFromUrl) {
        $(`input[name='show-ref-alt']`).prop("checked", showRefAltColumnsFromUrl == "1")
    }

    //update the variant input box last and trigger a search
    const variantFromUrl = $.urlParam('variant')
    if (variantFromUrl) {
        $("#variants-textarea").val(variantFromUrl)
        $("#submit-button").click()
    }
}

/*
const toggleRefAltScoreColumns = () => {
    const currentText = $("#toggle-ref-alt-scores-button").html()

    if (currentText.match(/Show/i)) {
        $(".ref-alt-score-column").show()
        $("#toggle-ref-alt-scores-button").removeClass('primary')
        $("#toggle-ref-alt-scores-button").html('Hide REF & ALT Scores')
    } else {
        $(".ref-alt-score-column").hide()
        $("#toggle-ref-alt-scores-button").addClass('primary')
        $("#toggle-ref-alt-scores-button").html('Show REF & ALT Scores')
    }
}
*/

// define function for parsing url parameters like ?variant=chr1-1234567-T-G
$.urlParam = (name) => {
    const results = new RegExp('[\?&#]?' + name + '=([^&#]*)').exec(window.location.hash);
    return (results !== null) ? decodeURIComponent(results[1]) || 0 : false;
}

$(document).ready(() => {
    $("#gencode-version").text(GENCODE_VERSION)
    // init UI elements
    $(".ui.checkbox").checkbox()
    $(".question, .exclamation, .score-table").popup({"on": "click"})
    $(".question, .exclamation, .score-table").css("cursor", "pointer")
    $("#variants-textarea").focus()
    $("#response-box").hide()

    // init event handlers
    $("#submit-button").click(handleSubmit)

    clearVcfFileInput()
    window.addEventListener("pageshow", () => {
        clearVcfFileInput()
    })

    $("#batch-vcf-file").on("change", updateVcfFileUI)
    $("#clear-vcf-file-btn").click(clearVcfFileInput)

    // delegated so it keeps working for the icons added by each new search
    $(document).on("click", ".per-position-table-icon:not(.per-position-table-icon-disabled)", function() {
        openPerPositionModal($(this).attr("data-icon-id"))
    })

    // The modal is a top-level overlay rather than part of #response-box, so it isn't covered by the
    // elements the search-reset path hides. Browser back/forward moves between the hashes written by
    // past searches, and the scores on screen belong to the one being navigated away from.
    $(window).on("hashchange", dismissPerPositionModal)

    // Delegated. The button lives in the modal header rather than in the table markup, so a direct
    // binding would work too, but the delegated form costs nothing.
    $(document).on("click", "#per-position-visualize-button", () => {
        // Run after the modal has finished hiding: Semantic UI keeps the page unscrollable while a
        // modal is up, so scrolling before then would be undone. onHidden is set through the settings
        // API rather than by re-initialising the modal, which would rebind the shared handler that
        // `$(".ui.modal").modal()` installs for every modal.
        $("#per-position-modal").modal("setting", "onHidden", function() {
            // Clear the callback before doing anything else: "setting" writes into the live modal
            // instance's settings object, which persists, so without this every later close of this
            // modal would scroll the page to the visualization as if Visualize had been clicked.
            $("#per-position-modal").modal("setting", "onHidden", function() {})
            // Reuse the Show button's own handler rather than repeating what it does. Clicking it
            // again when the browser is already open would re-run updateIgvBrowser for no reason.
            if (!$("#igv-div").is(":visible")) {
                $("#show-igv-button").click()
            }
            document.getElementById("igv-table").scrollIntoView({behavior: "smooth", block: "start"})
        }).modal("hide")
    })

    $("#batch-prev-btn").click(() => { void displayBatchVariantAtIndex(currentBatchIndex - 1) })
    $("#batch-next-btn").click(() => { void displayBatchVariantAtIndex(currentBatchIndex + 1) })
    $("#batch-variant-select").on("change", function() {
        void displayBatchVariantAtIndex(parseInt($(this).val(), 10))
    })

    $("#variants-textarea").on("paste", (event) => {
        const clipboardData = event.originalEvent?.clipboardData || window.clipboardData
        if (!clipboardData) return

        const pasted = clipboardData.getData("text")
        if (!pasted) return

        event.preventDefault()
        const normalized = normalizeVariantsText(pasted)
        const textarea = event.target
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        textarea.value = textarea.value.substring(0, start) + normalized + textarea.value.substring(end)
        const cursor = start + normalized.length
        textarea.selectionStart = cursor
        textarea.selectionEnd = cursor
    })

    $("#variants-textarea").keydown((event) => {
        if ((event.keyCode || event.which) !== 13) return
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        $("#submit-button").click()
    })
    $("#max-distance-input").keydown((event) => {
        if ((event.keyCode || event.which) == 13) {
            $("#submit-button").click()
        }
    })

    $("#show-igv-button").click(async () => {
        $("#show-igv-button").text("Update")
        $("#igv-div").show()
        await updateIgvBrowser(lastSpliceaiResponseJson, lastPangolinResponseJson, lastGenomeVersion)
    })

    /*
    $("#show-other-predictors-button").click(() => {
        $(".other-predictors-row").show()
        $("#show-other-predictors-row").hide()
    })
    */

    updateVisualizationCheckboxes(true, "38")

    applyUrlSettingsToFormElements()
})