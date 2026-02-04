#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$ROOT_DIR/VERSION"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Packages
NPM_PACKAGES=(
    "@crown-dev-studios/simple-auth-shared-types"
    "@crown-dev-studios/google-auth"
    "@crown-dev-studios/simple-auth-server-ts"
    "@crown-dev-studios/simple-auth-react-native"
)

usage() {
    echo "Usage: $0 [--dry-run] [--skip-npm] [--skip-python] [--skip-git]"
    echo ""
    echo "Deploys all packages to their respective registries."
    echo ""
    echo "Options:"
    echo "  --dry-run      Show what would be done without actually deploying"
    echo "  --skip-npm     Skip npm package publishing"
    echo "  --skip-python  Skip Python package publishing"
    echo "  --skip-git     Skip git tag push (useful for re-publishing)"
    echo ""
    echo "Prerequisites:"
    echo "  - npm login (for npm packages)"
    echo "  - TWINE_USERNAME and TWINE_PASSWORD env vars (for PyPI)"
    echo "  - All versions must be in sync (run ./scripts/check-version.sh)"
    echo "  - Working directory must be clean"
    exit 1
}

log_step() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

log_info() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Get version from VERSION file
get_version() {
    if [[ ! -f "$VERSION_FILE" ]]; then
        log_error "VERSION file not found"
        exit 1
    fi
    cat "$VERSION_FILE" | tr -d '[:space:]'
}

# Check if all versions are in sync
check_versions_in_sync() {
    log_step "Checking version consistency"

    local version="$1"
    local errors=0

    # Check npm packages
    for pkg_dir in shared-types simple-auth-react-native google-auth simple-auth-server-ts; do
        local pkg_file="$ROOT_DIR/packages/$pkg_dir/package.json"
        if [[ -f "$pkg_file" ]]; then
            local pkg_version
            pkg_version=$(node -e "console.log(require('$pkg_file').version)")
            if [[ "$pkg_version" != "$version" ]]; then
                log_error "$pkg_dir: $pkg_version (expected $version)"
                ((errors++))
            else
                log_info "$pkg_dir: $pkg_version"
            fi
        fi
    done

    # Check Python
    local pyproject="$ROOT_DIR/packages/simple-auth-server-python/pyproject.toml"
    if [[ -f "$pyproject" ]]; then
        local py_version
        py_version=$(grep '^version = ' "$pyproject" | sed 's/version = "\(.*\)"/\1/')
        if [[ "$py_version" != "$version" ]]; then
            log_error "simple-auth-server-python: $py_version (expected $version)"
            ((errors++))
        else
            log_info "simple-auth-server-python: $py_version"
        fi
    fi

    # Check podspec
    local podspec="$ROOT_DIR/packages/google-auth/CDSGoogleAuth.podspec"
    if [[ -f "$podspec" ]]; then
        local pod_version
        pod_version=$(grep "s.version" "$podspec" | sed "s/.*'\([^']*\)'.*/\1/")
        if [[ "$pod_version" != "$version" ]]; then
            log_error "CDSGoogleAuth.podspec: $pod_version (expected $version)"
            ((errors++))
        else
            log_info "CDSGoogleAuth.podspec: $pod_version"
        fi
    fi

    if [[ $errors -gt 0 ]]; then
        echo ""
        log_error "Version mismatch detected! Run: ./scripts/bump-version.sh $version"
        exit 1
    fi
}

# Check if version is already published on npm
check_npm_not_published() {
    local pkg="$1"
    local version="$2"

    local published_version
    published_version=$(npm view "$pkg" version 2>/dev/null || echo "")

    if [[ "$published_version" == "$version" ]]; then
        return 1  # Already published
    fi
    return 0  # Not published
}

# Check if version is already published on PyPI
check_pypi_not_published() {
    local version="$1"
    local pkg_name="simple-auth-server"

    # Check PyPI API
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "https://pypi.org/pypi/$pkg_name/$version/json")

    if [[ "$status_code" == "200" ]]; then
        return 1  # Already published
    fi
    return 0  # Not published
}

# Check if any packages are already published
check_not_already_deployed() {
    log_step "Checking deployment status"

    local version="$1"
    local already_published=()

    # Check npm packages
    for pkg in "${NPM_PACKAGES[@]}"; do
        if ! check_npm_not_published "$pkg" "$version"; then
            already_published+=("$pkg@$version (npm)")
        else
            log_info "$pkg@$version not yet published"
        fi
    done

    # Check PyPI
    if ! check_pypi_not_published "$version"; then
        already_published+=("simple-auth-server@$version (PyPI)")
    else
        log_info "simple-auth-server@$version not yet published (PyPI)"
    fi

    if [[ ${#already_published[@]} -gt 0 ]]; then
        echo ""
        log_warn "The following packages are already published:"
        for pkg in "${already_published[@]}"; do
            echo "  - $pkg"
        done
        echo ""
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Deployment cancelled"
            exit 1
        fi
    fi
}

# Check working directory is clean
check_clean_working_dir() {
    log_step "Checking working directory"

    if [[ -n $(git -C "$ROOT_DIR" status --porcelain) ]]; then
        log_error "Working directory is not clean. Commit or stash changes first."
        git -C "$ROOT_DIR" status --short
        exit 1
    fi
    log_info "Working directory is clean"
}

# Check git tag exists
check_git_tag_exists() {
    local version="$1"
    local tag="v$version"

    if ! git -C "$ROOT_DIR" tag -l "$tag" | grep -q "$tag"; then
        log_error "Git tag $tag does not exist"
        echo "Create it with: git tag -a $tag -m 'Release $tag'"
        exit 1
    fi
    log_info "Git tag $tag exists"
}

# Push git tag
push_git_tag() {
    local version="$1"
    local tag="v$version"
    local dry_run="$2"

    log_step "Pushing git tag"

    if [[ "$dry_run" == true ]]; then
        log_warn "[DRY RUN] Would push tag $tag to origin"
        return
    fi

    # Ensure we're on main and up to date
    local current_branch
    current_branch=$(git -C "$ROOT_DIR" branch --show-current)
    if [[ "$current_branch" != "main" ]]; then
        log_error "Not on main branch (currently on $current_branch)"
        exit 1
    fi

    git -C "$ROOT_DIR" push origin main
    git -C "$ROOT_DIR" push origin "$tag"
    log_info "Pushed $tag to origin"
}

# Build all packages
build_packages() {
    local dry_run="$1"

    log_step "Building packages"

    if [[ "$dry_run" == true ]]; then
        log_warn "[DRY RUN] Would run: pnpm install && pnpm build"
        return
    fi

    cd "$ROOT_DIR"
    pnpm install
    pnpm build
    log_info "All packages built successfully"
}

# Publish npm packages
publish_npm() {
    local version="$1"
    local dry_run="$2"

    log_step "Publishing npm packages"

    cd "$ROOT_DIR"

    for pkg in "${NPM_PACKAGES[@]}"; do
        local filter_name="${pkg#@crown-dev-studios/}"  # Remove scope for filter

        if [[ "$dry_run" == true ]]; then
            log_warn "[DRY RUN] Would publish: $pkg@$version"
        else
            echo -e "${YELLOW}Publishing $pkg...${NC}"
            pnpm --filter "$pkg" publish --access public --no-git-checks
            log_info "Published $pkg@$version"
        fi
    done
}

# Build and publish Python package
publish_python() {
    local version="$1"
    local dry_run="$2"

    log_step "Publishing Python package"

    local py_pkg_dir="$ROOT_DIR/packages/simple-auth-server-python"

    # Clean old dist
    rm -rf "$py_pkg_dir/dist"

    if [[ "$dry_run" == true ]]; then
        log_warn "[DRY RUN] Would build and publish simple-auth-server@$version to PyPI"
        return
    fi

    # Check for twine credentials
    if [[ -z "${TWINE_USERNAME:-}" ]] && [[ -z "${TWINE_TOKEN:-}" ]]; then
        if [[ ! -f ~/.pypirc ]]; then
            log_error "No PyPI credentials found. Set TWINE_USERNAME/TWINE_PASSWORD or TWINE_TOKEN, or create ~/.pypirc"
            exit 1
        fi
    fi

    # Build
    echo -e "${YELLOW}Building Python package...${NC}"
    python -m pip install --upgrade build twine --quiet
    python -m build "$py_pkg_dir"
    log_info "Python package built"

    # Upload
    echo -e "${YELLOW}Uploading to PyPI...${NC}"
    if [[ -n "${TWINE_TOKEN:-}" ]]; then
        python -m twine upload "$py_pkg_dir/dist/*" -u __token__ -p "$TWINE_TOKEN"
    else
        python -m twine upload "$py_pkg_dir/dist/*"
    fi
    log_info "Published simple-auth-server@$version to PyPI"
}

# Main
main() {
    local DRY_RUN=false
    local SKIP_NPM=false
    local SKIP_PYTHON=false
    local SKIP_GIT=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-npm)
                SKIP_NPM=true
                shift
                ;;
            --skip-python)
                SKIP_PYTHON=true
                shift
                ;;
            --skip-git)
                SKIP_GIT=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                ;;
        esac
    done

    local VERSION
    VERSION=$(get_version)

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          simple-auth deployment v$VERSION                  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"

    if [[ "$DRY_RUN" == true ]]; then
        echo ""
        echo -e "${YELLOW}  *** DRY RUN MODE - No changes will be made ***${NC}"
    fi

    # Pre-flight checks
    check_versions_in_sync "$VERSION"
    check_clean_working_dir
    check_git_tag_exists "$VERSION"
    check_not_already_deployed "$VERSION"

    # Confirm deployment
    echo ""
    echo -e "${YELLOW}Ready to deploy version $VERSION${NC}"
    echo ""
    echo "This will:"
    [[ "$SKIP_GIT" == false ]] && echo "  • Push tag v$VERSION to origin"
    echo "  • Build all packages"
    [[ "$SKIP_NPM" == false ]] && echo "  • Publish ${#NPM_PACKAGES[@]} npm packages"
    [[ "$SKIP_PYTHON" == false ]] && echo "  • Publish Python package to PyPI"
    echo ""

    if [[ "$DRY_RUN" == false ]]; then
        read -p "Proceed with deployment? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Deployment cancelled"
            exit 1
        fi
    fi

    # Execute deployment
    [[ "$SKIP_GIT" == false ]] && push_git_tag "$VERSION" "$DRY_RUN"
    build_packages "$DRY_RUN"
    [[ "$SKIP_NPM" == false ]] && publish_npm "$VERSION" "$DRY_RUN"
    [[ "$SKIP_PYTHON" == false ]] && publish_python "$VERSION" "$DRY_RUN"

    # Done!
    log_step "Deployment complete!"
    echo -e "${GREEN}Successfully deployed simple-auth v$VERSION${NC}"
    echo ""
    echo "Published:"
    [[ "$SKIP_NPM" == false ]] && for pkg in "${NPM_PACKAGES[@]}"; do
        echo "  • https://www.npmjs.com/package/$pkg"
    done
    [[ "$SKIP_PYTHON" == false ]] && echo "  • https://pypi.org/project/simple-auth-server/$VERSION/"
    echo ""
}

main "$@"
