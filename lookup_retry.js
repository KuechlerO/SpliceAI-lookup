/* Shared helpers for retrying transient GeneBe / Ensembl / VariantValidator failures.
 * Loaded as a classic script in the browser (exposes LookupRetry) and required by Node tests.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory()
    } else {
        root.LookupRetry = factory()
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict"

    const TRANSIENT_MESSAGE_RE = new RegExp(
        "Unable to reach server|Upstream proxy failed|Request timed out|"
        + "\\b429\\b|\\b502\\b|\\b503\\b|\\b504\\b|NetworkError|Failed to fetch",
        "i")

    const TIMEOUT_MESSAGE_RE = /timed out/i

    const errorMessage = (error) => {
        if (error == null) {
            return ""
        }
        if (typeof error === "string") {
            return error
        }
        return error.message || String(error)
    }

    const isLookupTimeoutError = (error) => TIMEOUT_MESSAGE_RE.test(errorMessage(error))

    const isTransientLookupError = (error) => {
        /* Network / proxy blips worth retrying. Not VEP variant rejections (ensemblRejected). */
        if (error && error.ensemblRejected) {
            return false
        }
        return TRANSIENT_MESSAGE_RE.test(errorMessage(error))
    }

    const isTransientHttpFailure = (responseJson) => {
        /* Flask/nginx/upstream HTTP failures that look like outages rather than VEP saying no. */
        if (!responseJson) {
            return true
        }
        const status = responseJson.httpStatus
        if (status === 0 || status === 429 || status === 502 || status === 503 || status === 504) {
            return true
        }
        const text = `${responseJson.error || ""}`
        return /Upstream proxy failed/i.test(text)
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const withRetries = async (fn, options = {}) => {
        /* Run fn up to attempts times. delaysMs[i] is waited before attempt i+1 (0-based).
         * shouldRetry(error, failedAttemptNumber) decides whether to try again.
         * onRetry(nextAttemptNumber) is called just before a retry wait/attempt. */
        const attempts = options.attempts == null ? 3 : options.attempts
        const delaysMs = options.delaysMs || [0, 1000, 2000]
        const shouldRetry = options.shouldRetry || isTransientLookupError
        const onRetry = options.onRetry || (() => {})

        let lastError = null
        for (let i = 0; i < attempts; i++) {
            const delay = delaysMs[i] || 0
            if (delay > 0) {
                await sleep(delay)
            }
            try {
                return await fn()
            } catch (e) {
                lastError = e
                const failedAttempt = i + 1
                if (failedAttempt >= attempts || !shouldRetry(e, failedAttempt)) {
                    throw e
                }
                onRetry(failedAttempt + 1)
            }
        }
        throw lastError
    }

    return {
        errorMessage,
        isLookupTimeoutError,
        isTransientLookupError,
        isTransientHttpFailure,
        withRetries,
    }
}))
