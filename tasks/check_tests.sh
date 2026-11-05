#!/bin/sh
# Runs both test suites; fails on any failed or unloadable suite (a suite that cannot load adds no
# "Tests:" line) and when jest ran fewer suites than test files exist. Read "Test Suites:", not "Tests:".
cd "$(dirname "$0")/.." || exit 1
(cd server && npm test >/dev/null 2>&1) || { echo "FAIL: server tests"; exit 1; }
cd app || exit 1
files=$(npx jest --listTests 2>/dev/null | grep -c .)
out=$(npx jest 2>&1); code=$?
echo "$out" | grep -E '^(Test Suites|Tests):'
[ $code -eq 0 ] || { echo "FAIL: jest exit $code (a suite may have failed to load)"; exit 1; }
ran=$(echo "$out" | sed -n 's/^Test Suites:.* \([0-9]*\) total.*/\1/p')
[ "$ran" = "$files" ] || { echo "FAIL: jest ran $ran suites but $files test files exist"; exit 1; }
echo "OK: server and $ran app suites"
