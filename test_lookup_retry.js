#!/usr/bin/env node
/* Unit tests for lookup_retry.js (transient HGVS conversion retries).
 * Run: node test_lookup_retry.js
 */
"use strict"

const assert = require("assert")
const {
    isLookupTimeoutError,
    isTransientLookupError,
    isTransientHttpFailure,
    withRetries,
} = require("./lookup_retry.js")

let passed = 0
const check = (name, fn) => {
    fn()
    passed += 1
    console.log(`ok - ${name}`)
}

const checkAsync = async (name, fn) => {
    await fn()
    passed += 1
    console.log(`ok - ${name}`)
}

;(async () => {
    check("Unable to reach server is transient", () => {
        assert.strictEqual(isTransientLookupError(new Error("Unable to reach server")), true)
        assert.strictEqual(isTransientLookupError("Unable to reach server"), true)
    })

    check("Upstream proxy failed is transient", () => {
        assert.strictEqual(
            isTransientLookupError(new Error("Upstream proxy failed: timed out")), true)
    })

    check("HTTP 502/503/429 messages are transient", () => {
        assert.strictEqual(isTransientLookupError(new Error("502 Bad Gateway")), true)
        assert.strictEqual(isTransientLookupError(new Error("503")), true)
        assert.strictEqual(isTransientLookupError(new Error("429 Too Many Requests")), true)
    })

    check("ensemblRejected is never transient", () => {
        const e = new Error("REF does not match")
        e.ensemblRejected = true
        assert.strictEqual(isTransientLookupError(e), false)
    })

    check("timeout detection", () => {
        const e = new Error("Request timed out after 90 seconds")
        assert.strictEqual(isLookupTimeoutError(e), true)
        // Timeout messages also match the transient regex; callers use isLookupTimeoutError
        // to skip Ensembl retries specifically.
        assert.strictEqual(isTransientLookupError(e), true)
        assert.strictEqual(isLookupTimeoutError(new Error("Unable to reach server")), false)
    })

    check("isTransientHttpFailure for Flask 502 vs VEP 400", () => {
        assert.strictEqual(isTransientHttpFailure({
            ok: false,
            httpStatus: 502,
            error: "Upstream proxy failed: <urlopen error timed out>",
        }), true)
        assert.strictEqual(isTransientHttpFailure({
            ok: false,
            httpStatus: 400,
            error: "(A) does not match reference allele given by HGVS notation",
        }), false)
        assert.strictEqual(isTransientHttpFailure({
            ok: false,
            httpStatus: 503,
            error: "Service Unavailable",
        }), true)
    })

    await checkAsync("withRetries succeeds on first attempt", async () => {
        let calls = 0
        const result = await withRetries(async () => {
            calls += 1
            return "ok"
        }, {attempts: 3, delaysMs: [0, 0, 0]})
        assert.strictEqual(result, "ok")
        assert.strictEqual(calls, 1)
    })

    await checkAsync("withRetries retries transient errors then succeeds", async () => {
        let calls = 0
        const retries = []
        const result = await withRetries(async () => {
            calls += 1
            if (calls < 3) {
                throw new Error("Unable to reach server")
            }
            return "recovered"
        }, {
            attempts: 3,
            delaysMs: [0, 0, 0],
            shouldRetry: isTransientLookupError,
            onRetry: (n) => retries.push(n),
        })
        assert.strictEqual(result, "recovered")
        assert.strictEqual(calls, 3)
        assert.deepStrictEqual(retries, [2, 3])
    })

    await checkAsync("withRetries does not retry ensemblRejected", async () => {
        let calls = 0
        const rejection = new Error("bad REF")
        rejection.ensemblRejected = true
        let threw = null
        try {
            await withRetries(async () => {
                calls += 1
                throw rejection
            }, {
                attempts: 3,
                delaysMs: [0, 0, 0],
                shouldRetry: (e) => !e.ensemblRejected && isTransientLookupError(e),
            })
        } catch (e) {
            threw = e
        }
        assert.ok(threw && threw.ensemblRejected)
        assert.strictEqual(calls, 1)
    })

    await checkAsync("withRetries does not retry timeout when shouldRetry says no", async () => {
        let calls = 0
        let threw = null
        try {
            await withRetries(async () => {
                calls += 1
                throw new Error("Request timed out after 90 seconds")
            }, {
                attempts: 3,
                delaysMs: [0, 0, 0],
                shouldRetry: (e) => !isLookupTimeoutError(e) && isTransientLookupError(e),
            })
        } catch (e) {
            threw = e
        }
        assert.ok(threw && /timed out/.test(threw.message))
        assert.strictEqual(calls, 1)
    })

    console.log(`\nAll ${passed} checks passed`)
})().catch((e) => {
    console.error(e)
    process.exit(1)
})
