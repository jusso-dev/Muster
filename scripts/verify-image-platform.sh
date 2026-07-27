#!/usr/bin/env bash
set -euo pipefail

jq -e '
  [
    .manifests[]
    | select(
        .mediaType == "application/vnd.oci.image.manifest.v1+json"
        or .mediaType == "application/vnd.docker.distribution.manifest.v2+json"
      )
    | select(
        (.annotations["vnd.docker.reference.type"] // "")
        != "attestation-manifest"
      )
  ] as $application_manifests
  | $application_manifests | length == 1
  and $application_manifests[0].platform.os == "linux"
  and $application_manifests[0].platform.architecture == "amd64"
' >/dev/null
