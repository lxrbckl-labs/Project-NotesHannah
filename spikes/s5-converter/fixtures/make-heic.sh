#!/bin/sh
# HEIC fixture needs macOS sips (run after make_fixtures.py): PNG -> HEIC (HEVC).
cd "$(dirname "$0")/generated" && sips -s format heic photo-for-heic.png --out photo.heic
