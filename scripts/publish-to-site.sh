#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/danielalmazan.com-repository" >&2
  exit 2
fi

site_repository="$1"
destination="$site_repository/elections/general-elections-hex"
if [[ ! -d "$site_repository/.git" ]]; then
  echo "Not a Git repository: $site_repository" >&2
  exit 2
fi

npm run check
mkdir -p "$destination"
rsync -a --delete dist/ "$destination/"
echo "Copied the validated artifact to $destination"
