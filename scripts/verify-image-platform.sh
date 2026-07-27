#!/usr/bin/env bash
set -euo pipefail

jq -e '
  def image_manifest:
    .mediaType == "application/vnd.oci.image.manifest.v1+json"
    or .mediaType == "application/vnd.docker.distribution.manifest.v2+json";
  def attestation:
    image_manifest
    and .annotations["vnd.docker.reference.type"] == "attestation-manifest";

  .manifests as $manifests
  | [$manifests[] | select(attestation | not)] as $application_manifests
  | [$manifests[] | select(attestation)] as $attestation_manifests
  | ($application_manifests | length) == 1
  and ($attestation_manifests | length) >= 1
  and ($manifests | length)
    == (($application_manifests | length) + ($attestation_manifests | length))
  and ($application_manifests[0] | image_manifest)
  and ($application_manifests[0].digest | startswith("sha256:"))
  and $application_manifests[0].platform.os == "linux"
  and $application_manifests[0].platform.architecture == "amd64"
  and (
    $attestation_manifests
    | all(
        .platform.os == "unknown"
        and .platform.architecture == "unknown"
        and .annotations["vnd.docker.reference.digest"]
          == $application_manifests[0].digest
      )
  )
' >/dev/null
