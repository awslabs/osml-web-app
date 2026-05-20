/*
 * Copyright Amazon.com, Inc. or its affiliates.
 *
 * Trust anchor for the Node.js install in `web-ui-construct.ts`.
 *
 * The constant below is the SHA256 of the Node.js project's official GPG
 * release keyring (`pubring.kbx`), which is the file used to verify the
 * detached PGP signature on each release's SHASUMS256.txt. The keyring
 * itself is downloaded from a public location at instance-launch time:
 *
 *   https://github.com/nodejs/release-keys/raw/HEAD/gpg/pubring.kbx
 *
 * Pinning the hash here means a tampered or rolled-back keyring file
 * (from any source — GitHub, a mirror, an MITM, a cache) is detected
 * before any signature verification trusts its contents.
 *
 * To update: download the current keyring, run `sha256sum`, paste the
 * value below. Only required when the Node.js project rotates release
 * managers (years-long cadence). See https://github.com/nodejs/node#release-keys.
 *
 * This value is isolated in its own module so the corresponding
 * `SECRET-BASE64-HIGH-ENTROPY-STRING` suppression in `.ash/ash.yaml`
 * applies to a single one-line file. Any other high-entropy string
 * introduced into `web-ui-construct.ts` will still trip the detector.
 */
export const NODEJS_KEYRING_SHA256 =
  "fa1274830f9b9c126329ae64fcd96e0e93d4b3ff12ab68ab29f886be275eb241";
