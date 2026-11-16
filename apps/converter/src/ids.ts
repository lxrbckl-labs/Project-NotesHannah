/**
 * Strict shapes for everything a job file contributes to a filesystem path.
 * A prefixed ULID is `<prefix>_<26 Crockford base32 characters>`; nothing else may reach a path.
 */
const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
export const JOB_ID = new RegExp(`^job_${ULID}$`);
export const USER_ID = new RegExp(`^usr_${ULID}$`);
export const FILE_ID = new RegExp(`^fil_${ULID}$`);
export const SHA256 = /^[0-9a-f]{64}$/;
/** The only file names the worker will pick up from queue/pending. */
export const JOB_FILE = new RegExp(`^(job_${ULID})\\.json$`);
