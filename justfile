default:
    @just --list

check: fmt skills-check extensions-check

fmt:
    dprint fmt

md-fmt:
    dprint fmt

skills-check:
    just --justfile skills/justfile check

extensions-check:
    just --justfile extensions/justfile check

remove-hooks:
    rm -f .git/hooks/pre-commit
    echo "✓ Pre-commit hook removed"

setup-hooks:
    #!/usr/bin/env sh
    echo '#!/bin/sh' > .git/hooks/pre-commit
    echo 'just check || exit 1' >> .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✓ Pre-commit hook installed"

regen-manifest:
    node scripts/regen-pi-manifest.mjs

# Primary flow: edit in pi-shit, then publish mirrors.
publish:
    @just publish-skills
    @just publish-extensions

publish-skills skills-branch="master":
    git subtree push --prefix=skills pi-skills {{skills-branch}}

publish-extensions extensions-branch="main":
    git subtree push --prefix=extensions pi-extensions {{extensions-branch}}

# Repair flow: pull one-off direct downstream edits back into pi-shit.
update:
    @just update-skills
    @just update-extensions
    @just update-themes
    @just regen-manifest

update-skills skills-branch="master":
    git subtree pull --prefix=skills pi-skills {{skills-branch}}

update-extensions extensions-branch="main":
    git subtree pull --prefix=extensions pi-extensions {{extensions-branch}}

update-themes:
    mkdir -p themes
    curl -fsSL https://raw.githubusercontent.com/zenobi-us/pi-rose-pine/main/themes/rose-pine-main.json -o themes/rose-pine.json
    curl -fsSL https://raw.githubusercontent.com/zenobi-us/pi-rose-pine/main/themes/rose-pine-dawn.json -o themes/rose-pine-dawn.json
