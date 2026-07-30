#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer npx puppeteer browsers install chrome
