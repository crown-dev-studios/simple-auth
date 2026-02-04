#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 <version|major|minor|patch> [--tag] [--push]"
    echo ""
    echo "Arguments:"
    echo "  <version>    Explicit version (e.g., 1.2.3)"
    echo "  major        Bump major version (1.2.3 -> 2.0.0)"
    echo "  minor        Bump minor version (1.2.3 -> 1.3.0)"
    echo "  patch        Bump patch version (1.2.3 -> 1.2.4)"
    echo ""
    echo "Options:"
    echo "  --tag        Create a git tag (v<version>)"
    echo "  --push       Push commits and tags to origin"
    echo ""
    echo "Examples:"
    echo "  $0 0.2.0              # Set version to 0.2.0"
    echo "  $0 patch              # Bump patch version"
    echo "  $0 minor --tag        # Bump minor and create tag"
    echo "  $0 1.0.0 --tag --push # Release version 1.0.0"
    exit 1
}

# Get current version
get_current_version() {
    if [[ -f "$VERSION_FILE" ]]; then
        cat "$VERSION_FILE" | tr -d '[:space:]'
    else
        echo "0.0.0"
    fi
}

# Parse semver components
parse_version() {
    local version="$1"
    IFS='.' read -r MAJOR MINOR PATCH <<< "$version"
    MAJOR=${MAJOR:-0}
    MINOR=${MINOR:-0}
    PATCH=${PATCH:-0}
}

# Calculate new version based on bump type
calculate_new_version() {
    local current="$1"
    local bump_type="$2"

    parse_version "$current"

    case "$bump_type" in
        major)
            echo "$((MAJOR + 1)).0.0"
            ;;
        minor)
            echo "$MAJOR.$((MINOR + 1)).0"
            ;;
        patch)
            echo "$MAJOR.$MINOR.$((PATCH + 1))"
            ;;
        *)
            # Assume it's an explicit version
            echo "$bump_type"
            ;;
    esac
}

# Validate version format
validate_version() {
    local version="$1"
    if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}Error: Invalid version format '$version'. Expected: X.Y.Z${NC}"
        exit 1
    fi
}

# Update VERSION file
update_version_file() {
    local version="$1"
    echo "$version" > "$VERSION_FILE"
    echo -e "${GREEN}✓${NC} Updated VERSION file"
}

# Update package.json files (preserves formatting)
update_package_json() {
    local file="$1"
    local version="$2"

    if [[ -f "$file" ]]; then
        # Use sed to update only the version field, preserving formatting
        sed -i '' 's/"version": "[^"]*"/"version": "'"$version"'"/' "$file"
        echo -e "${GREEN}✓${NC} Updated $(basename "$(dirname "$file")")/package.json"
    fi
}

# Update internal dependency versions in package.json (preserves formatting)
update_internal_deps() {
    local file="$1"
    local version="$2"
    local updated=false

    if [[ -f "$file" ]]; then
        # Update each internal package dependency
        local internal_packages=(
            "@crown-dev-studios/simple-auth-shared-types"
            "@crown-dev-studios/simple-auth-react-native"
            "@crown-dev-studios/google-auth"
            "@crown-dev-studios/simple-auth-server-ts"
        )

        for pkg in "${internal_packages[@]}"; do
            if grep -q "\"$pkg\"" "$file"; then
                sed -i '' "s|\"$pkg\": \"\\^[^\"]*\"|\"$pkg\": \"^$version\"|g" "$file"
                updated=true
            fi
        done

        if [[ "$updated" == true ]]; then
            echo "  └─ Updated internal dependencies"
        fi
    fi
}

# Update pyproject.toml
update_pyproject() {
    local file="$1"
    local version="$2"

    if [[ -f "$file" ]]; then
        sed -i '' "s/^version = \".*\"/version = \"$version\"/" "$file"
        echo -e "${GREEN}✓${NC} Updated simple-auth-server-python/pyproject.toml"
    fi
}

# Update podspec files
update_podspec() {
    local file="$1"
    local version="$2"

    if [[ -f "$file" ]]; then
        sed -i '' "s/s\.version[[:space:]]*=[[:space:]]*'[^']*'/s.version      = '$version'/" "$file"
        echo -e "${GREEN}✓${NC} Updated $(basename "$file")"
    fi
}

# Main script
main() {
    local CREATE_TAG=false
    local PUSH=false
    local VERSION_ARG=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --tag)
                CREATE_TAG=true
                shift
                ;;
            --push)
                PUSH=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                if [[ -z "$VERSION_ARG" ]]; then
                    VERSION_ARG="$1"
                else
                    echo -e "${RED}Error: Unexpected argument '$1'${NC}"
                    usage
                fi
                shift
                ;;
        esac
    done

    if [[ -z "$VERSION_ARG" ]]; then
        echo -e "${RED}Error: Version argument required${NC}"
        usage
    fi

    # Get current and new versions
    local CURRENT_VERSION
    CURRENT_VERSION=$(get_current_version)
    local NEW_VERSION
    NEW_VERSION=$(calculate_new_version "$CURRENT_VERSION" "$VERSION_ARG")

    validate_version "$NEW_VERSION"

    echo ""
    echo -e "${YELLOW}Bumping version: $CURRENT_VERSION → $NEW_VERSION${NC}"
    echo ""

    # Update all version files
    update_version_file "$NEW_VERSION"

    # npm packages
    local PACKAGE_DIRS=(
        "packages/shared-types"
        "packages/simple-auth-react-native"
        "packages/google-auth"
        "packages/simple-auth-server-ts"
    )

    for dir in "${PACKAGE_DIRS[@]}"; do
        local pkg_file="$ROOT_DIR/$dir/package.json"
        update_package_json "$pkg_file" "$NEW_VERSION"
        update_internal_deps "$pkg_file" "$NEW_VERSION"
    done

    # Python
    update_pyproject "$ROOT_DIR/packages/simple-auth-server-python/pyproject.toml" "$NEW_VERSION"

    # iOS podspec
    update_podspec "$ROOT_DIR/packages/google-auth/CDSGoogleAuth.podspec" "$NEW_VERSION"

    echo ""
    echo -e "${GREEN}All versions updated to $NEW_VERSION${NC}"

    # Git operations
    if [[ "$CREATE_TAG" == true ]]; then
        echo ""
        echo -e "${YELLOW}Creating git commit and tag...${NC}"

        git -C "$ROOT_DIR" add -A
        git -C "$ROOT_DIR" commit -m "chore: bump version to $NEW_VERSION"
        git -C "$ROOT_DIR" tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

        echo -e "${GREEN}✓${NC} Created commit and tag v$NEW_VERSION"

        if [[ "$PUSH" == true ]]; then
            echo ""
            echo -e "${YELLOW}Pushing to origin...${NC}"
            git -C "$ROOT_DIR" push origin main
            git -C "$ROOT_DIR" push origin "v$NEW_VERSION"
            echo -e "${GREEN}✓${NC} Pushed to origin"
        fi
    fi

    echo ""
    echo -e "${GREEN}Done!${NC}"

    if [[ "$CREATE_TAG" == false ]]; then
        echo ""
        echo "Next steps:"
        echo "  1. Review changes: git diff"
        echo "  2. Commit: git add -A && git commit -m 'chore: bump version to $NEW_VERSION'"
        echo "  3. Tag: git tag -a v$NEW_VERSION -m 'Release v$NEW_VERSION'"
        echo "  4. Push: git push origin main && git push origin v$NEW_VERSION"
        echo ""
        echo "Or run: $0 $NEW_VERSION --tag --push"
    fi
}

main "$@"
