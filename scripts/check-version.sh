#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get expected version from VERSION file
if [[ ! -f "$VERSION_FILE" ]]; then
    echo -e "${RED}Error: VERSION file not found${NC}"
    exit 1
fi

EXPECTED_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
echo -e "${YELLOW}Expected version: $EXPECTED_VERSION${NC}"
echo ""

ERRORS=0

# Check a package.json file
check_package_json() {
    local file="$1"
    local name="$2"

    if [[ -f "$file" ]]; then
        local version
        version=$(node -e "console.log(require('$file').version)")
        if [[ "$version" == "$EXPECTED_VERSION" ]]; then
            echo -e "${GREEN}✓${NC} $name: $version"
        else
            echo -e "${RED}✗${NC} $name: $version (expected $EXPECTED_VERSION)"
            ((ERRORS++))
        fi
    else
        echo -e "${YELLOW}⚠${NC} $name: file not found"
    fi
}

# Check pyproject.toml
check_pyproject() {
    local file="$1"
    local name="$2"

    if [[ -f "$file" ]]; then
        local version
        version=$(grep '^version = ' "$file" | sed 's/version = "\(.*\)"/\1/')
        if [[ "$version" == "$EXPECTED_VERSION" ]]; then
            echo -e "${GREEN}✓${NC} $name: $version"
        else
            echo -e "${RED}✗${NC} $name: $version (expected $EXPECTED_VERSION)"
            ((ERRORS++))
        fi
    else
        echo -e "${YELLOW}⚠${NC} $name: file not found"
    fi
}

# Check podspec
check_podspec() {
    local file="$1"
    local name="$2"

    if [[ -f "$file" ]]; then
        local version
        version=$(grep "s.version" "$file" | sed "s/.*'\([^']*\)'.*/\1/")
        if [[ "$version" == "$EXPECTED_VERSION" ]]; then
            echo -e "${GREEN}✓${NC} $name: $version"
        else
            echo -e "${RED}✗${NC} $name: $version (expected $EXPECTED_VERSION)"
            ((ERRORS++))
        fi
    else
        echo -e "${YELLOW}⚠${NC} $name: file not found"
    fi
}

# Check git tag exists
check_git_tag() {
    local tag="v$EXPECTED_VERSION"
    if git -C "$ROOT_DIR" tag -l "$tag" | grep -q "$tag"; then
        echo -e "${GREEN}✓${NC} Git tag: $tag exists"
    else
        echo -e "${YELLOW}⚠${NC} Git tag: $tag not found (run with --tag to create)"
    fi
}

echo "Package versions:"
check_package_json "$ROOT_DIR/packages/shared-types/package.json" "shared-types"
check_package_json "$ROOT_DIR/packages/simple-auth-react-native/package.json" "simple-auth-react-native"
check_package_json "$ROOT_DIR/packages/google-auth/package.json" "google-auth"
check_package_json "$ROOT_DIR/packages/simple-auth-server-ts/package.json" "simple-auth-server-ts"
check_pyproject "$ROOT_DIR/packages/simple-auth-server-python/pyproject.toml" "simple-auth-server-python"
check_podspec "$ROOT_DIR/packages/google-auth/CDSGoogleAuth.podspec" "CDSGoogleAuth.podspec"

echo ""
echo "Git:"
check_git_tag

echo ""
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}Found $ERRORS version mismatches!${NC}"
    echo "Run: ./scripts/bump-version.sh $EXPECTED_VERSION"
    exit 1
else
    echo -e "${GREEN}All versions are in sync!${NC}"
fi
