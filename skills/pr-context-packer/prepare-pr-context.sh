#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(pwd)"
BASE_REF=""
BUDGET=272000
OUTPUT_NAME="pr-context.txt"
TMP_OUTPUT=true
WITH_SCRIBE=true
SCRIBE_INCLUDE_DEPENDENTS=true
SCRIBE_MAX_DEPTH=2
SCRIBE_MAX_FILES=25
SCRIBE_TARGET_LIMIT=0
MAX_RELATED=80
WITH_DOCS=false
WITH_TESTS=true
INCLUDE_LOCKFILES=false
INCLUDE_ENV=false
INCLUDE_SECRETS=false
NO_CLIPBOARD=false
FAIL_OVER_BUDGET=false
INSTALL_TOOLS=false
DIFF_CONTEXT=3
INCLUDE_PR_DESCRIPTION=true
PR_REF=""

show_help() {
    cat <<'EOF'
Build a PR-focused LLM context pack: PR description + diff + full changed files + budget-fit related files.

Usage:
    prepare-pr-context.sh [project_dir] [options]

Options:
    --base <ref>             Base ref for PR diff (default: auto-detect origin/main, origin/master, main, master)
    --output <name>          Output filename (default: pr-context.txt)
    --tmp-output             Write to /tmp/context-packer/... (default)
    --in-project-output      Write to <repo>/prompt/
    --budget <tokens>        Token budget threshold (default: 272000)
    --no-scribe              Disable Scribe relevance expansion
    --no-dependents          Disable dependent-file expansion in Scribe
    --scribe-max-depth <n>   Scribe covering-set max depth (default: 2)
    --scribe-max-files <n>   Scribe covering-set max files per target (default: 25)
    --scribe-target-limit <n>Limit changed files used as Scribe targets (default: 0 = all)
    --max-related <n>        Max ranked related candidates considered before budget fitting (default: 80, 0 = none)
    --with-docs              Include docs/ files in related expansion
    --no-tests               Exclude tests from related expansion
    --include-lockfiles      Include lockfiles
    --include-env            Include env files (.env, .env.*, .envrc)
    --include-secrets        Include potentially sensitive files (.npmrc, keys/certs, etc.)
    --diff-context <n>       Git diff context lines (default: 3)
    --pr <ref>               Explicit PR number/url/branch for gh lookup (optional)
    --no-pr-description      Skip auto-including GitHub PR title/body section
    --no-clipboard           Do not copy final output to clipboard
    --fail-over-budget       Exit with code 2 when tokens exceed budget
    --install-tools          Install missing tokencount (cargo install tokencount)
    -h, --help               Show this help

Examples:
    prepare-pr-context.sh ~/dev/mobile-1 --base origin/main
    prepare-pr-context.sh ~/dev/mobile-1 --base origin/main --tmp-output --budget 272000
    prepare-pr-context.sh ~/dev/mobile-1 --base origin/main --no-scribe --max-related 0

Generated manifests include:
    *.changed.files.txt
    *.related.files.txt
    *.omitted.files.txt
    *.related.omitted.files.txt
    *.related.selection.tsv
    *.scribe.targets.tsv
EOF
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

count_lines() {
    local path="$1"
    if [[ -s "$path" ]]; then
        wc -l < "$path" | tr -d '[:space:]'
    else
        echo 0
    fi
}

is_allowed_extension() {
    local rel="$1"
    case "$rel" in
        *.rs|*.zig|*.c|*.h|*.cpp|*.hpp|*.cc|*.hh|*.m|*.mm|*.swift|*.kt|*.kts|*.java|*.py|*.go|*.rb|*.php|*.cs|*.fs|*.lua|*.r|\
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.svelte|*.vue|\
        *.css|*.scss|*.sass|*.less|*.html|*.htm|*.svg|*.xml|*.xsd|*.xsl|\
        *.json|*.jsonc|*.toml|*.yaml|*.yml|*.ini|*.cfg|*.conf|*.properties|\
        *.md|*.mdx|*.rst|*.txt|\
        *.sh|*.bash|*.zsh|*.fish|*.ps1|\
        *.sql|*.graphql|*.gql|*.proto|*.tf|*.tfvars|*.cmake|*.gradle)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_explicit_include() {
    local rel="$1"
    local base
    base="$(basename "$rel")"

    case "$base" in
        Dockerfile|Containerfile|Makefile|GNUmakefile|justfile|Justfile|Procfile|Procfile.*|\
        Brewfile|Gemfile|Gemfile.*|Rakefile|Rakefile.*|Vagrantfile|\
        CMakeLists.txt|meson.build|meson_options.txt|BUILD|BUILD.bazel|WORKSPACE|WORKSPACE.bazel|MODULE.bazel|\
        Jenkinsfile|Tiltfile|Podfile|Cartfile|Fastfile|flake.nix|default.nix|shell.nix|Taskfile)
            return 0
            ;;
        .editorconfig|.gitignore|.gitattributes|.dockerignore|\
        .npmrc|.nvmrc|.prettierignore|.prettierrc|.eslintignore|\
        .tool-versions|.python-version|.ruby-version|.node-version|.terraform.lock.hcl)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_lockfile() {
    local rel="$1"
    case "$rel" in
        pnpm-lock.yaml|*/pnpm-lock.yaml|\
        package-lock.json|*/package-lock.json|\
        yarn.lock|*/yarn.lock|\
        bun.lock|*/bun.lock|bun.lockb|*/bun.lockb|\
        npm-shrinkwrap.json|*/npm-shrinkwrap.json|\
        Cargo.lock|*/Cargo.lock|\
        composer.lock|*/composer.lock|\
        Gemfile.lock|*/Gemfile.lock|\
        poetry.lock|*/poetry.lock|\
        Pipfile.lock|*/Pipfile.lock)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_env_path() {
    local rel="$1"
    case "$rel" in
        .env|.env.*|*/.env|*/.env.*|.envrc|*/.envrc)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_secret_path() {
    local rel="$1"
    local base
    base="$(basename "$rel")"

    case "$rel" in
        .npmrc|*/.npmrc|.pypirc|*/.pypirc|.netrc|*/.netrc|\
        .aws/credentials|*/.aws/credentials|.aws/config|*/.aws/config|\
        .gem/credentials|*/.gem/credentials)
            return 0
            ;;
    esac

    case "$base" in
        id_rsa|id_dsa|id_ecdsa|id_ed25519|\
        google-services.json|GoogleService-Info.plist|\
        firebase-adminsdk*.json|*service-account*.json|*serviceaccount*.json)
            return 0
            ;;
    esac

    case "$rel" in
        *.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|*.kdbx|*.pkcs12|*.der|*.crt|*.cer|*.csr|\
        *.mobileprovision|*.provisionprofile)
            return 0
            ;;
    esac

    return 1
}

is_docs_path() {
    local rel="$1"
    case "$rel" in
        docs/*|*/docs/*|doc/*|*/doc/*|documentation/*|*/documentation/*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_test_path() {
    local rel="$1"
    case "$rel" in
        __tests__/*|*/__tests__/*|\
        test/*|*/test/*|tests/*|*/tests/*|\
        *.test.*|*.spec.*|*_test.*|test_*.py)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_hard_excluded_path() {
    local rel="$1"
    case "$rel" in
        .git/*|*/.git/*|.hg/*|*/.hg/*|.svn/*|*/.svn/*|\
        node_modules/*|*/node_modules/*|\
        prompt/*|*/prompt/*|\
        dist/*|*/dist/*|build/*|*/build/*|target/*|*/target/*|out/*|*/out/*|coverage/*|*/coverage/*|\
        .next/*|*/.next/*|.nuxt/*|*/.nuxt/*|.svelte-kit/*|*/.svelte-kit/*|.turbo/*|*/.turbo/*|\
        .cache/*|*/.cache/*|.parcel-cache/*|*/.parcel-cache/*|\
        .venv/*|*/.venv/*|venv/*|*/venv/*|\
        __pycache__/*|*/__pycache__/*|.pytest_cache/*|*/.pytest_cache/*|.mypy_cache/*|*/.mypy_cache/*|\
        .terraform/*|*/.terraform/*|.direnv/*|*/.direnv/*|\
        .gradle/*|*/.gradle/*|.idea/*|*/.idea/*|\
        *.egg-info/*|*/*.egg-info/*)
            return 0
            ;;
    esac

    case "$rel" in
        .DS_Store|*/.DS_Store|*CHATGPT_CODE_DUMP*|*code-dump*.txt)
            return 0
            ;;
    esac

    return 1
}

is_scribe_target_candidate() {
    local rel="$1"
    case "$rel" in
        *.rs|*.py|*.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|*.go)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_probably_text_file() {
    local rel="$1"
    local abs="$REPO_ROOT/$rel"

    if [[ ! -f "$abs" ]]; then
        return 1
    fi

    if [[ ! -s "$abs" ]]; then
        return 0
    fi

    LC_ALL=C grep -Iq . "$abs"
}

should_include_changed_file() {
    local rel="$1"

    if is_hard_excluded_path "$rel"; then
        return 1
    fi

    if [[ "$INCLUDE_ENV" != true ]] && is_env_path "$rel"; then
        return 1
    fi

    if [[ "$INCLUDE_SECRETS" != true ]] && is_secret_path "$rel"; then
        return 1
    fi

    if [[ "$INCLUDE_LOCKFILES" != true ]] && is_lockfile "$rel"; then
        return 1
    fi

    if is_explicit_include "$rel" || is_allowed_extension "$rel" || is_lockfile "$rel" || is_probably_text_file "$rel"; then
        return 0
    fi

    return 1
}

should_include_related_file() {
    local rel="$1"

    if is_hard_excluded_path "$rel"; then
        return 1
    fi

    if [[ "$INCLUDE_ENV" != true ]] && is_env_path "$rel"; then
        return 1
    fi

    if [[ "$INCLUDE_SECRETS" != true ]] && is_secret_path "$rel"; then
        return 1
    fi

    if [[ "$INCLUDE_LOCKFILES" != true ]] && is_lockfile "$rel"; then
        return 1
    fi

    if [[ "$WITH_DOCS" != true ]] && is_docs_path "$rel"; then
        return 1
    fi

    if [[ "$WITH_TESTS" != true ]] && is_test_path "$rel"; then
        return 1
    fi

    if is_explicit_include "$rel" || is_allowed_extension "$rel" || is_lockfile "$rel"; then
        return 0
    fi

    return 1
}

reason_for_omitted_changed_file() {
    local rel="$1"

    if [[ "$INCLUDE_LOCKFILES" != true ]] && is_lockfile "$rel"; then
        echo "lockfile"
        return 0
    fi

    if [[ "$INCLUDE_ENV" != true ]] && is_env_path "$rel"; then
        echo "env"
        return 0
    fi

    if [[ "$INCLUDE_SECRETS" != true ]] && is_secret_path "$rel"; then
        echo "secret"
        return 0
    fi

    if is_hard_excluded_path "$rel"; then
        echo "generated/cache"
        return 0
    fi

    if ! is_probably_text_file "$rel"; then
        echo "binary/non-text"
        return 0
    fi

    echo "filtered"
}

reason_for_omitted_related_file() {
    local rel="$1"

    if [[ "$INCLUDE_LOCKFILES" != true ]] && is_lockfile "$rel"; then
        echo "lockfile"
        return 0
    fi

    if [[ "$INCLUDE_ENV" != true ]] && is_env_path "$rel"; then
        echo "env"
        return 0
    fi

    if [[ "$INCLUDE_SECRETS" != true ]] && is_secret_path "$rel"; then
        echo "secret"
        return 0
    fi

    if [[ "$WITH_DOCS" != true ]] && is_docs_path "$rel"; then
        echo "docs"
        return 0
    fi

    if [[ "$WITH_TESTS" != true ]] && is_test_path "$rel"; then
        echo "tests"
        return 0
    fi

    if is_hard_excluded_path "$rel"; then
        echo "generated/cache"
        return 0
    fi

    if ! is_probably_text_file "$rel"; then
        echo "binary/non-text"
        return 0
    fi

    echo "filtered"
}

parse_tokencount_total() {
    local raw="$1"
    printf '%s\n' "$raw" | awk 'NR==1 {print $1}'
}

count_tokens_for_path() {
    local input_path="$1"
    local include_ext="$2"
    local raw
    local tokens

    raw="$(tokencount --encoding o200k-base --include-ext "$include_ext" "$input_path")"
    tokens="$(parse_tokencount_total "$raw")"

    if [[ ! "$tokens" =~ ^[0-9]+$ ]]; then
        echo "❌ Failed to parse tokencount output for: $input_path" >&2
        echo "$raw" >&2
        return 1
    fi

    printf '%s\n' "$tokens"
}

estimate_related_block_tokens() {
    local rel="$1"
    local scratch_path="$2"
    local src="$REPO_ROOT/$rel"

    : > "$scratch_path"

    printf '### %s\n\n' "$rel" >> "$scratch_path"
    printf '```\n' >> "$scratch_path"
    cat "$src" >> "$scratch_path"

    if [[ -s "$src" ]]; then
        local last_char
        last_char="$(tail -c 1 "$src" || true)"
        if [[ "$last_char" != $'\n' ]]; then
            printf '\n' >> "$scratch_path"
        fi
    fi

    printf '```\n\n' >> "$scratch_path"

    count_tokens_for_path "$scratch_path" "txt"
}

rebuild_related_list_from_included() {
    local included_path="$1"
    local related_list_path="$2"

    if [[ -s "$included_path" ]]; then
        awk -F'\t' '{print $1}' "$included_path" > "$related_list_path"
    else
        : > "$related_list_path"
    fi
}

drop_last_line() {
    local input_path="$1"
    local scratch_path="$2"
    local line_count

    line_count="$(count_lines "$input_path")"

    if [[ "$line_count" -le 1 ]]; then
        : > "$input_path"
        return 0
    fi

    awk -v keep="$((line_count - 1))" 'NR <= keep { print }' "$input_path" > "$scratch_path"
    mv "$scratch_path" "$input_path"
}

sum_selected_related_tokens() {
    local included_path="$1"

    if [[ ! -s "$included_path" ]]; then
        echo 0
        return 0
    fi

    awk -F'\t' 'BEGIN { sum = 0 } NF >= 3 { sum += $3 } END { printf "%d\n", sum }' "$included_path"
}

ensure_tokencount() {
    if command_exists tokencount; then
        return 0
    fi

    if [[ "$INSTALL_TOOLS" == true ]]; then
        if ! command_exists cargo; then
            echo "❌ cargo not found; cannot install tokencount" >&2
            return 1
        fi
        echo "ℹ️ Installing tokencount via cargo..." >&2
        cargo install tokencount
    fi

    if ! command_exists tokencount; then
        echo "❌ tokencount not found. Install with: cargo install tokencount" >&2
        return 1
    fi

    return 0
}

run_scribe() {
    if command_exists scribe; then
        scribe "$@"
        return $?
    fi

    if command_exists npx; then
        npx -y @sibyllinesoft/scribe "$@"
        return $?
    fi

    return 127
}

ensure_scribe() {
    if [[ "$WITH_SCRIBE" != true ]]; then
        return 0
    fi

    if command_exists scribe || command_exists npx; then
        return 0
    fi

    echo "⚠️ Scribe not found (scribe or npx unavailable); continuing without related expansion" >&2
    WITH_SCRIBE=false
    return 0
}

copy_output_to_clipboard() {
    local output_path="$1"

    if [[ "$NO_CLIPBOARD" == true ]]; then
        return 0
    fi

    if command_exists pbcopy; then
        pbcopy < "$output_path"
        return 0
    fi

    if command_exists wl-copy; then
        wl-copy < "$output_path"
        return 0
    fi

    echo "ℹ️ Clipboard tool not found (pbcopy/wl-copy). Output file was still written." >&2
    return 0
}

render_file_blocks() {
    local list_path="$1"
    local output_path="$2"

    while IFS= read -r rel; do
        [[ -z "$rel" ]] && continue

        local src="$REPO_ROOT/$rel"
        if [[ ! -f "$src" ]]; then
            continue
        fi

        printf '### %s\n\n' "$rel" >> "$output_path"
        printf '```\n' >> "$output_path"
        cat "$src" >> "$output_path"

        if [[ -s "$src" ]]; then
            local last_char
            last_char="$(tail -c 1 "$src" || true)"
            if [[ "$last_char" != $'\n' ]]; then
                printf '\n' >> "$output_path"
            fi
        fi

        printf '```\n\n' >> "$output_path"
    done < "$list_path"
}

write_pr_description_section() {
    local output_path="$1"

    if [[ "$INCLUDE_PR_DESCRIPTION" != true ]]; then
        return 1
    fi

    if ! command_exists gh; then
        return 1
    fi

    local -a gh_args
    gh_args=(pr view --json number,title,body,url,baseRefName,headRefName,state,author)
    if [[ -n "$PR_REF" ]]; then
        gh_args=(pr view "$PR_REF" --json number,title,body,url,baseRefName,headRefName,state,author)
    fi

    local pr_json
    if ! pr_json="$(cd "$REPO_ROOT" && gh "${gh_args[@]}" 2>/dev/null)"; then
        return 1
    fi

    PR_JSON="$pr_json" python3 - <<'PY' > "$output_path"
import json
import os

pr = json.loads(os.environ["PR_JSON"])
author = pr.get("author") or {}
body = (pr.get("body") or "(no description)").rstrip()

print("# PR Description")
print()
print(f"- PR: #{pr.get('number', '')}")
print(f"- Title: {pr.get('title', '')}")
print(f"- URL: {pr.get('url', '')}")
print(f"- State: {pr.get('state', '')}")
print(f"- Base: {pr.get('baseRefName', '')}")
print(f"- Head: {pr.get('headRefName', '')}")
print(f"- Author: {author.get('login', '')}")
print()
print("## Body")
print()
print(body)
PY
}

write_context_pack_output() {
    local output_path="$1"
    local related_list_path="$2"
    local related_count="$3"

    {
        if [[ "$pr_description_included" == true ]]; then
            cat "$PR_DESC_PATH"
            echo ""
            echo "---"
            echo ""
        fi

        echo "# PR Context Pack"
        echo ""
        echo "- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "- Repo root: $REPO_ROOT"
        echo "- Working dir: $PROJECT_DIR"
        echo "- Base ref: $BASE_REF"
        echo "- Base commit: $BASE_COMMIT"
        echo "- Head commit: $HEAD_COMMIT"
        echo "- Scribe expansion: $WITH_SCRIBE"
        if [[ "$WITH_SCRIBE" == true ]]; then
            echo "- Scribe targets queried: ${scribe_targets_queried_count:-0}/${scribe_targets_eligible_count:-0} eligible"
            echo "- Scribe settings: max-depth=$SCRIBE_MAX_DEPTH, max-files=$SCRIBE_MAX_FILES, target-limit=$SCRIBE_TARGET_LIMIT, include-dependents=$SCRIBE_INCLUDE_DEPENDENTS"
        fi
        echo "- Token budget: $BUDGET"
        echo ""

        echo "## Changed files (git name-status)"
        echo ""
        echo '```text'
        cat "$STATUS_PATH"
        echo '```'
        echo ""

        echo "## Git diff ($BASE_COMMIT...$HEAD_COMMIT)"
        echo ""
        echo '```diff'
        cat "$DIFF_PATH"
        echo '```'
        echo ""

        echo "## Full current code: changed files ($changed_count)"
        echo ""
    } > "$output_path"

    render_file_blocks "$CHANGED_LIST" "$output_path"

    {
        echo "## Full current code: related files ($related_count)"
        echo ""

        if [[ "$WITH_SCRIBE" == true ]]; then
            echo "_Source: Scribe covering-set expansion_"
        else
            echo "_Scribe expansion disabled_"
        fi

        echo ""
        echo "_Related selection: hits=${related_candidate_hits:-0}, unique=${related_unique_count:-0}, pool=${related_pool_count:-0}, included=$related_count, omitted-over-budget=${related_omitted_budget_count:-0}_"

        if [[ "${related_omitted_max_related_count:-0}" -gt 0 ]]; then
            echo ""
            echo "_Candidates omitted by --max-related=$MAX_RELATED: ${related_omitted_max_related_count}_"
        fi

        if [[ "${related_omitted_changed_overlap_count:-0}" -gt 0 ]]; then
            echo ""
            echo "_Candidates already included as changed files: ${related_omitted_changed_overlap_count}_"
        fi

        if [[ "${related_omitted_filtered_count:-0}" -gt 0 ]]; then
            echo ""
            echo "_Candidates filtered by safety/path rules: ${related_omitted_filtered_count}_"
        fi

        if [[ "${scribe_targets_skipped_limit_count:-0}" -gt 0 ]]; then
            echo ""
            echo "_Scribe targets skipped by --scribe-target-limit=$SCRIBE_TARGET_LIMIT: ${scribe_targets_skipped_limit_count}_"
        fi

        if [[ "${scribe_targets_failed_count:-0}" -gt 0 ]]; then
            echo ""
            echo "_Scribe queries failed: ${scribe_targets_failed_count}_"
        fi

        if [[ "${scribe_targets_hit_max_files_count:-0}" -gt 0 ]]; then
            echo ""
            echo "_⚠️ Targets that returned at least --max-files=$SCRIBE_MAX_FILES paths: ${scribe_targets_hit_max_files_count}_"
        fi

        if [[ "${baseline_tokens_estimate:-0}" -gt 0 ]]; then
            echo ""
            echo "_Budget-fit estimate: baseline(no-related)=${baseline_tokens_estimate}, selected-related≈${related_tokens_selected_estimate:-0}, remaining≈${related_budget_remaining_estimate:-0}_"
        fi

        echo ""
    } >> "$output_path"

    render_file_blocks "$related_list_path" "$output_path"

    {
        echo "## Omitted changed files ($omitted_count)"
        echo ""

        if [[ "$omitted_count" -eq 0 ]]; then
            echo "None"
        else
            while IFS=$'\t' read -r rel reason; do
                [[ -z "$rel" ]] && continue
                if [[ -n "$reason" ]]; then
                    echo "- $rel — $reason"
                else
                    echo "- $rel"
                fi
            done < "$OMITTED_LIST"
        fi

        echo ""
    } >> "$output_path"
}

resolve_base_ref() {
    if [[ -n "$BASE_REF" ]]; then
        if git -C "$REPO_ROOT" rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1; then
            return 0
        fi

        echo "❌ Base ref not found: $BASE_REF" >&2
        return 1
    fi

    for candidate in origin/main origin/master main master; do
        if git -C "$REPO_ROOT" rev-parse --verify "$candidate^{commit}" >/dev/null 2>&1; then
            BASE_REF="$candidate"
            return 0
        fi
    done

    BASE_REF="HEAD~1"
    if git -C "$REPO_ROOT" rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1; then
        return 0
    fi

    echo "❌ Could not auto-detect base ref (tried origin/main, origin/master, main, master, HEAD~1)" >&2
    return 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --base)
            BASE_REF="$2"
            shift 2
            ;;
        --output)
            OUTPUT_NAME="$2"
            shift 2
            ;;
        --tmp-output)
            TMP_OUTPUT=true
            shift
            ;;
        --in-project-output)
            TMP_OUTPUT=false
            shift
            ;;
        --budget)
            BUDGET="$2"
            shift 2
            ;;
        --no-scribe)
            WITH_SCRIBE=false
            shift
            ;;
        --no-dependents)
            SCRIBE_INCLUDE_DEPENDENTS=false
            shift
            ;;
        --scribe-max-depth)
            SCRIBE_MAX_DEPTH="$2"
            shift 2
            ;;
        --scribe-max-files)
            SCRIBE_MAX_FILES="$2"
            shift 2
            ;;
        --scribe-target-limit)
            SCRIBE_TARGET_LIMIT="$2"
            shift 2
            ;;
        --max-related)
            MAX_RELATED="$2"
            shift 2
            ;;
        --with-docs)
            WITH_DOCS=true
            shift
            ;;
        --no-tests)
            WITH_TESTS=false
            shift
            ;;
        --include-lockfiles)
            INCLUDE_LOCKFILES=true
            shift
            ;;
        --include-env)
            INCLUDE_ENV=true
            shift
            ;;
        --include-secrets)
            INCLUDE_SECRETS=true
            shift
            ;;
        --diff-context)
            DIFF_CONTEXT="$2"
            shift 2
            ;;
        --pr)
            PR_REF="$2"
            shift 2
            ;;
        --no-pr-description)
            INCLUDE_PR_DESCRIPTION=false
            shift
            ;;
        --no-clipboard)
            NO_CLIPBOARD=true
            shift
            ;;
        --fail-over-budget)
            FAIL_OVER_BUDGET=true
            shift
            ;;
        --install-tools)
            INSTALL_TOOLS=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -* )
            echo "❌ Unknown option: $1" >&2
            show_help
            exit 1
            ;;
        *)
            PROJECT_DIR="$1"
            shift
            ;;
    esac
done

if [[ ! -d "$PROJECT_DIR" ]]; then
    echo "❌ Project directory not found: $PROJECT_DIR" >&2
    exit 1
fi

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"

if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "❌ Not a git repository: $PROJECT_DIR" >&2
    exit 1
fi

REPO_ROOT="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel)"

if [[ ! "$BUDGET" =~ ^[0-9]+$ ]]; then
    echo "❌ Budget must be an integer: $BUDGET" >&2
    exit 1
fi

for number_arg in "$SCRIBE_MAX_DEPTH" "$SCRIBE_MAX_FILES" "$SCRIBE_TARGET_LIMIT" "$MAX_RELATED" "$DIFF_CONTEXT"; do
    if [[ ! "$number_arg" =~ ^[0-9]+$ ]]; then
        echo "❌ Numeric option must be an integer: $number_arg" >&2
        exit 1
    fi
done

if [[ "$INCLUDE_ENV" == true || "$INCLUDE_SECRETS" == true ]]; then
    echo "⚠️ Including potentially sensitive files (env/secrets)" >&2
fi

ensure_tokencount
ensure_scribe
resolve_base_ref

BASE_COMMIT="$(git -C "$REPO_ROOT" merge-base HEAD "$BASE_REF")"
HEAD_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"

WORK_DIR="$(mktemp -d "/tmp/pr-context-packer.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

CHANGED_RAW="$WORK_DIR/changed.raw.txt"
CHANGED_LIST="$WORK_DIR/changed.files.txt"
RELATED_CANDIDATES="$WORK_DIR/related.candidates.txt"
RELATED_LIST="$WORK_DIR/related.files.txt"
OMITTED_LIST="$WORK_DIR/omitted.files.txt"
STATUS_PATH="$WORK_DIR/name-status.txt"
DIFF_PATH="$WORK_DIR/pr.diff"

: > "$CHANGED_LIST"
: > "$RELATED_CANDIDATES"
: > "$RELATED_LIST"
: > "$OMITTED_LIST"

git -C "$REPO_ROOT" diff --name-only --diff-filter=ACMR "$BASE_COMMIT...HEAD" > "$CHANGED_RAW"
git -C "$REPO_ROOT" diff --name-status "$BASE_COMMIT...HEAD" > "$STATUS_PATH"
git -C "$REPO_ROOT" diff --no-color --unified="$DIFF_CONTEXT" "$BASE_COMMIT...HEAD" > "$DIFF_PATH"

if [[ ! -s "$CHANGED_RAW" ]]; then
    echo "❌ No changed files found between $BASE_REF and HEAD" >&2
    exit 1
fi

while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue

    src="$REPO_ROOT/$rel"
    if [[ ! -f "$src" ]]; then
        printf '%s\t%s\n' "$rel" "missing" >> "$OMITTED_LIST"
        continue
    fi

    if should_include_changed_file "$rel"; then
        printf '%s\n' "$rel" >> "$CHANGED_LIST"
    else
        reason="$(reason_for_omitted_changed_file "$rel")"
        printf '%s\t%s\n' "$rel" "$reason" >> "$OMITTED_LIST"
    fi
done < "$CHANGED_RAW"

if [[ ! -s "$CHANGED_LIST" ]]; then
    echo "❌ No eligible changed files after filtering" >&2
    exit 1
fi

LC_ALL=C sort -u "$CHANGED_LIST" -o "$CHANGED_LIST"

RELATED_FILTERED_RAW="$WORK_DIR/related.filtered.raw.txt"
RELATED_FILTERED_UNIQUE="$WORK_DIR/related.filtered.unique.txt"
RELATED_RANKED="$WORK_DIR/related.ranked.tsv"
RELATED_POOL="$WORK_DIR/related.pool.tsv"
RELATED_INCLUDED="$WORK_DIR/related.included.tsv"
RELATED_OMITTED_OVERLAP="$WORK_DIR/related.omitted.overlap.tsv"
RELATED_OMITTED_MAX_RELATED="$WORK_DIR/related.omitted.max-related.tsv"
RELATED_OMITTED_BUDGET="$WORK_DIR/related.omitted.budget.tsv"
RELATED_OMITTED_LIST="$WORK_DIR/related.omitted.files.txt"
RELATED_SELECTION_REPORT="$WORK_DIR/related.selection.tsv"
SCRIBE_TARGET_REPORT="$WORK_DIR/scribe.targets.tsv"
TOKEN_SCRATCH="$WORK_DIR/token-scratch.txt"
DROP_SCRATCH="$WORK_DIR/drop-last.tmp"
BASELINE_OUTPUT_PATH="$WORK_DIR/pr-context.baseline.txt"
EMPTY_RELATED="$WORK_DIR/related.empty.txt"

: > "$RELATED_FILTERED_RAW"
: > "$RELATED_FILTERED_UNIQUE"
: > "$RELATED_RANKED"
: > "$RELATED_POOL"
: > "$RELATED_INCLUDED"
: > "$RELATED_OMITTED_OVERLAP"
: > "$RELATED_OMITTED_MAX_RELATED"
: > "$RELATED_OMITTED_BUDGET"
: > "$RELATED_OMITTED_LIST"
: > "$RELATED_SELECTION_REPORT"
: > "$SCRIBE_TARGET_REPORT"
: > "$TOKEN_SCRATCH"
: > "$DROP_SCRATCH"
: > "$BASELINE_OUTPUT_PATH"
: > "$EMPTY_RELATED"

printf 'target\tstatus\ttotal_paths\teligible_paths\tnote\n' > "$SCRIBE_TARGET_REPORT"

scribe_targets_eligible_count=0
scribe_targets_queried_count=0
scribe_targets_skipped_limit_count=0
scribe_targets_failed_count=0
scribe_targets_hit_max_files_count=0

if [[ "$WITH_SCRIBE" == true && "$MAX_RELATED" -ne 0 ]]; then
    while IFS= read -r target; do
        [[ -z "$target" ]] && continue

        if ! is_scribe_target_candidate "$target"; then
            continue
        fi

        scribe_targets_eligible_count=$((scribe_targets_eligible_count + 1))

        if [[ "$SCRIBE_TARGET_LIMIT" -gt 0 && "$scribe_targets_queried_count" -ge "$SCRIBE_TARGET_LIMIT" ]]; then
            scribe_targets_skipped_limit_count=$((scribe_targets_skipped_limit_count + 1))
            printf '%s\t%s\t%s\t%s\t%s\n' "$target" "skipped" "0" "0" "target-limit" >> "$SCRIBE_TARGET_REPORT"
            continue
        fi

        scribe_targets_queried_count=$((scribe_targets_queried_count + 1))
        scribe_out="$WORK_DIR/scribe-${scribe_targets_queried_count}.xml"

        scribe_args=(
            "$REPO_ROOT"
            --covering-set "$target"
            --granularity file
            --max-depth "$SCRIBE_MAX_DEPTH"
            --max-files "$SCRIBE_MAX_FILES"
            --stdout
        )

        if [[ "$SCRIBE_INCLUDE_DEPENDENTS" == true ]]; then
            scribe_args+=(--include-dependents)
        fi

        if ! run_scribe "${scribe_args[@]}" > "$scribe_out" 2>/dev/null; then
            scribe_targets_failed_count=$((scribe_targets_failed_count + 1))
            printf '%s\t%s\t%s\t%s\t%s\n' "$target" "failed" "0" "0" "scribe-error" >> "$SCRIBE_TARGET_REPORT"
            continue
        fi

        scribe_total_paths=0
        scribe_eligible_paths=0

        while IFS= read -r abs_path; do
            [[ -z "$abs_path" ]] && continue
            scribe_total_paths=$((scribe_total_paths + 1))

            if [[ "$abs_path" != "$REPO_ROOT"/* ]]; then
                continue
            fi

            rel_path="${abs_path#$REPO_ROOT/}"
            [[ "$rel_path" == "$target" ]] && continue
            [[ ! -f "$REPO_ROOT/$rel_path" ]] && continue

            if should_include_related_file "$rel_path"; then
                printf '%s\n' "$rel_path" >> "$RELATED_CANDIDATES"
                scribe_eligible_paths=$((scribe_eligible_paths + 1))
            else
                reason="$(reason_for_omitted_related_file "$rel_path")"
                printf '%s\t%s\n' "$rel_path" "$reason" >> "$RELATED_FILTERED_RAW"
            fi
        done < <(rg -o '<path>[^<]+</path>' "$scribe_out" | sed -E 's#<path>(.*)</path>#\1#')

        scribe_note=""
        if [[ "$scribe_total_paths" -ge "$SCRIBE_MAX_FILES" ]]; then
            scribe_targets_hit_max_files_count=$((scribe_targets_hit_max_files_count + 1))
            scribe_note="hit-max-files-limit"
        fi

        printf '%s\t%s\t%s\t%s\t%s\n' "$target" "ok" "$scribe_total_paths" "$scribe_eligible_paths" "$scribe_note" >> "$SCRIBE_TARGET_REPORT"
    done < "$CHANGED_LIST"
fi

if [[ -s "$RELATED_FILTERED_RAW" ]]; then
    LC_ALL=C sort -t $'\t' -k1,1 -k2,2 "$RELATED_FILTERED_RAW" | awk -F'\t' '!seen[$1]++ { print $1 "\t" $2 }' > "$RELATED_FILTERED_UNIQUE"
fi

related_candidate_hits="$(count_lines "$RELATED_CANDIDATES")"

if [[ -s "$RELATED_CANDIDATES" ]]; then
    LC_ALL=C sort "$RELATED_CANDIDATES" | uniq -c | awk '
        {
            count = $1
            sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
            printf "%s\t%d\n", $0, count
        }
    ' > "$WORK_DIR/related.counts.unsorted.tsv"

    LC_ALL=C sort -t $'\t' -k2,2nr -k1,1 "$WORK_DIR/related.counts.unsorted.tsv" > "$RELATED_RANKED"
fi

related_unique_count="$(count_lines "$RELATED_RANKED")"
related_pool_count=0
related_omitted_changed_overlap_count=0
related_omitted_max_related_count=0
related_omitted_filtered_count="$(count_lines "$RELATED_FILTERED_UNIQUE")"

while IFS=$'\t' read -r rel frequency; do
    [[ -z "$rel" ]] && continue

    if grep -Fxq "$rel" "$CHANGED_LIST"; then
        printf '%s\t%s\n' "$rel" "$frequency" >> "$RELATED_OMITTED_OVERLAP"
        related_omitted_changed_overlap_count=$((related_omitted_changed_overlap_count + 1))
        continue
    fi

    if [[ "$MAX_RELATED" -ge 0 && "$related_pool_count" -ge "$MAX_RELATED" ]]; then
        printf '%s\t%s\n' "$rel" "$frequency" >> "$RELATED_OMITTED_MAX_RELATED"
        related_omitted_max_related_count=$((related_omitted_max_related_count + 1))
        continue
    fi

    related_pool_count=$((related_pool_count + 1))
    printf '%s\t%s\n' "$rel" "$frequency" >> "$RELATED_POOL"
done < "$RELATED_RANKED"

changed_count="$(count_lines "$CHANGED_LIST")"
omitted_count="$(count_lines "$OMITTED_LIST")"

PR_DESC_PATH="$WORK_DIR/pr-description.md"
pr_description_included=false
if write_pr_description_section "$PR_DESC_PATH"; then
    pr_description_included=true
else
    if [[ "$INCLUDE_PR_DESCRIPTION" == true ]]; then
        echo "ℹ️ PR description unavailable via gh (no matching PR, gh missing, or not authenticated)" >&2
    fi
fi

related_omitted_budget_count=0
baseline_tokens_estimate=0
related_tokens_selected_estimate=0
related_budget_remaining_estimate=0

write_context_pack_output "$BASELINE_OUTPUT_PATH" "$EMPTY_RELATED" 0
baseline_tokens_estimate="$(count_tokens_for_path "$BASELINE_OUTPUT_PATH" "txt")"
remaining_budget=$((BUDGET - baseline_tokens_estimate))
related_budget_remaining_estimate="$remaining_budget"

if [[ "$remaining_budget" -gt 0 ]]; then
    while IFS=$'\t' read -r rel frequency; do
        [[ -z "$rel" ]] && continue

        token_cost="$(estimate_related_block_tokens "$rel" "$TOKEN_SCRATCH")"

        if [[ "$token_cost" -le "$remaining_budget" ]]; then
            printf '%s\t%s\t%s\n' "$rel" "$frequency" "$token_cost" >> "$RELATED_INCLUDED"
            remaining_budget=$((remaining_budget - token_cost))
        else
            printf '%s\t%s\t%s\t%s\n' "$rel" "$frequency" "$token_cost" "budget-fit-estimate" >> "$RELATED_OMITTED_BUDGET"
            related_omitted_budget_count=$((related_omitted_budget_count + 1))
        fi
    done < "$RELATED_POOL"
else
    while IFS=$'\t' read -r rel frequency; do
        [[ -z "$rel" ]] && continue
        printf '%s\t%s\t%s\t%s\n' "$rel" "$frequency" "-" "baseline-over-budget" >> "$RELATED_OMITTED_BUDGET"
        related_omitted_budget_count=$((related_omitted_budget_count + 1))
    done < "$RELATED_POOL"
fi

rebuild_related_list_from_included "$RELATED_INCLUDED" "$RELATED_LIST"
related_count="$(count_lines "$RELATED_LIST")"
related_tokens_selected_estimate="$(sum_selected_related_tokens "$RELATED_INCLUDED")"
related_budget_remaining_estimate=$((BUDGET - baseline_tokens_estimate - related_tokens_selected_estimate))

repo_slug="$(basename "$REPO_ROOT" | tr ' ' '-' | tr -cd '[:alnum:]._-')"
timestamp="$(date +%Y%m%d-%H%M%S)"

if [[ "$TMP_OUTPUT" == true ]]; then
    OUTPUT_DIR="/tmp/context-packer/pr-${repo_slug}-${timestamp}"
else
    OUTPUT_DIR="$REPO_ROOT/prompt"
fi

mkdir -p "$OUTPUT_DIR"

OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_NAME"
BASE_NAME="${OUTPUT_NAME%.*}"
if [[ -z "$BASE_NAME" ]]; then
    BASE_NAME="$OUTPUT_NAME"
fi

CHANGED_MANIFEST="$OUTPUT_DIR/${BASE_NAME}.changed.files.txt"
RELATED_MANIFEST="$OUTPUT_DIR/${BASE_NAME}.related.files.txt"
OMITTED_MANIFEST="$OUTPUT_DIR/${BASE_NAME}.omitted.files.txt"
RELATED_OMITTED_MANIFEST="$OUTPUT_DIR/${BASE_NAME}.related.omitted.files.txt"
RELATED_SELECTION_MANIFEST="$OUTPUT_DIR/${BASE_NAME}.related.selection.tsv"
SCRIBE_MANIFEST="$OUTPUT_DIR/${BASE_NAME}.scribe.targets.tsv"

output_ext="${OUTPUT_NAME##*.}"
if [[ "$output_ext" == "$OUTPUT_NAME" ]]; then
    output_ext="txt"
fi

write_context_pack_output "$OUTPUT_PATH" "$RELATED_LIST" "$related_count"
TOKENS="$(count_tokens_for_path "$OUTPUT_PATH" "$output_ext")"

while (( TOKENS > BUDGET )); do
    if [[ ! -s "$RELATED_INCLUDED" ]]; then
        break
    fi

    last_entry="$(tail -n 1 "$RELATED_INCLUDED")"
    last_rel="$(printf '%s\n' "$last_entry" | awk -F'\t' '{print $1}')"
    last_frequency="$(printf '%s\n' "$last_entry" | awk -F'\t' '{print $2}')"
    last_tokens="$(printf '%s\n' "$last_entry" | awk -F'\t' '{print $3}')"

    drop_last_line "$RELATED_INCLUDED" "$DROP_SCRATCH"
    printf '%s\t%s\t%s\t%s\n' "$last_rel" "$last_frequency" "$last_tokens" "post-build-trim-over-budget" >> "$RELATED_OMITTED_BUDGET"

    related_omitted_budget_count=$((related_omitted_budget_count + 1))
    rebuild_related_list_from_included "$RELATED_INCLUDED" "$RELATED_LIST"

    related_count="$(count_lines "$RELATED_LIST")"
    related_tokens_selected_estimate="$(sum_selected_related_tokens "$RELATED_INCLUDED")"
    related_budget_remaining_estimate=$((BUDGET - baseline_tokens_estimate - related_tokens_selected_estimate))

    write_context_pack_output "$OUTPUT_PATH" "$RELATED_LIST" "$related_count"
    TOKENS="$(count_tokens_for_path "$OUTPUT_PATH" "$output_ext")"
done

related_omitted_budget_count="$(count_lines "$RELATED_OMITTED_BUDGET")"

printf 'path\tfrequency\ttokens_estimate\tdecision\treason\n' > "$RELATED_SELECTION_REPORT"
: > "$RELATED_OMITTED_LIST"

while IFS=$'\t' read -r rel reason; do
    [[ -z "$rel" ]] && continue
    reason_value="filtered:${reason:-filtered}"
    printf '%s\t%s\n' "$rel" "$reason_value" >> "$RELATED_OMITTED_LIST"
    printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "-" "-" "omitted" "$reason_value" >> "$RELATED_SELECTION_REPORT"
done < "$RELATED_FILTERED_UNIQUE"

while IFS=$'\t' read -r rel frequency; do
    [[ -z "$rel" ]] && continue
    reason_value="already-in-changed-files"
    printf '%s\t%s\n' "$rel" "$reason_value" >> "$RELATED_OMITTED_LIST"
    printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "$frequency" "-" "omitted" "$reason_value" >> "$RELATED_SELECTION_REPORT"
done < "$RELATED_OMITTED_OVERLAP"

while IFS=$'\t' read -r rel frequency; do
    [[ -z "$rel" ]] && continue
    reason_value="max-related-cap:$MAX_RELATED"
    printf '%s\t%s\n' "$rel" "$reason_value" >> "$RELATED_OMITTED_LIST"
    printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "$frequency" "-" "omitted" "$reason_value" >> "$RELATED_SELECTION_REPORT"
done < "$RELATED_OMITTED_MAX_RELATED"

while IFS=$'\t' read -r rel frequency token_cost reason; do
    [[ -z "$rel" ]] && continue
    reason_value="${reason:-over-budget}"
    printf '%s\t%s\n' "$rel" "$reason_value" >> "$RELATED_OMITTED_LIST"
    printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "${frequency:--}" "${token_cost:--}" "omitted" "$reason_value" >> "$RELATED_SELECTION_REPORT"
done < "$RELATED_OMITTED_BUDGET"

while IFS=$'\t' read -r rel frequency token_cost; do
    [[ -z "$rel" ]] && continue
    printf '%s\t%s\t%s\t%s\t%s\n' "$rel" "$frequency" "$token_cost" "included" "within-budget" >> "$RELATED_SELECTION_REPORT"
done < "$RELATED_INCLUDED"

LC_ALL=C sort -u "$RELATED_OMITTED_LIST" -o "$RELATED_OMITTED_LIST"

cp "$CHANGED_LIST" "$CHANGED_MANIFEST"
cp "$RELATED_LIST" "$RELATED_MANIFEST"
cp "$OMITTED_LIST" "$OMITTED_MANIFEST"
cp "$RELATED_OMITTED_LIST" "$RELATED_OMITTED_MANIFEST"
cp "$RELATED_SELECTION_REPORT" "$RELATED_SELECTION_MANIFEST"
cp "$SCRIBE_TARGET_REPORT" "$SCRIBE_MANIFEST"

copy_output_to_clipboard "$OUTPUT_PATH"

echo ""
echo "✅ PR context pack ready"
echo "📁 Project:               $PROJECT_DIR"
echo "📂 Out dir:               $OUTPUT_DIR"
echo "📄 Output:                $OUTPUT_PATH"
echo "📝 PR description:        $pr_description_included"
echo "🧾 Changed manifest:      $CHANGED_MANIFEST"
echo "🧾 Related manifest:      $RELATED_MANIFEST"
echo "🧾 Omitted manifest:      $OMITTED_MANIFEST"
echo "🧾 Related omitted:       $RELATED_OMITTED_MANIFEST"
echo "🧾 Related selection:     $RELATED_SELECTION_MANIFEST"
echo "🧾 Scribe target report:  $SCRIBE_MANIFEST"
echo "📦 Changed files:         $changed_count"
echo "📦 Related files:         $related_count"
echo "🔎 Related candidate hits:$related_candidate_hits"
echo "🔎 Related unique/pool:   $related_unique_count / $related_pool_count"
echo "🔎 Related omitted budget:$related_omitted_budget_count"
echo "🔎 Scribe targets used:   $scribe_targets_queried_count / $scribe_targets_eligible_count"
echo "🔎 Scribe max-files hits: $scribe_targets_hit_max_files_count"
echo "🔢 Tokens:                $TOKENS (o200k-base)"
echo "🎯 Budget:                $BUDGET"

if (( TOKENS > BUDGET )); then
    echo "⚠️ Over budget by $((TOKENS - BUDGET)) tokens"
    if [[ "$FAIL_OVER_BUDGET" == true ]]; then
        exit 2
    fi
else
    echo "✅ Within budget by $((BUDGET - TOKENS)) tokens"
fi
