#!/usr/bin/env bash
# Ghoster-Go build script.
# Pins a working macOS SDK — the default (27.0) ships malformed .tbd files
# that the current linker can't parse (arm64e.x1 unknown architecture).
set -e

export PATH="$PATH:$(go env GOPATH)/bin"

# Pick the newest stable SDK that isn't the broken 27.x
for sdk in MacOSX26.5.sdk MacOSX15.5.sdk MacOSX15.sdk MacOSX14.5.sdk; do
  if [ -d "/Library/Developer/CommandLineTools/SDKs/$sdk" ]; then
    export SDKROOT="/Library/Developer/CommandLineTools/SDKs/$sdk"
    echo "Using SDK: $sdk"
    break
  fi
done

wails build "$@"
