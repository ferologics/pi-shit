default:
    @just --list

check: md-fmt

md-fmt:
    dprint fmt --staged --allow-no-files

remove-hooks:
    rm -f .git/hooks/pre-commit
    echo "✓ Pre-commit hook removed"

setup-hooks:
    #!/usr/bin/env sh
    echo '#!/bin/sh' > .git/hooks/pre-commit
    echo 'just check || exit 1' >> .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✓ Pre-commit hook installed"

update:
    @just update-skills
    @just update-extensions
    @just update-themes
    @just regen-manifest

regen-manifest:
    node scripts/regen-pi-manifest.mjs

update-skills skills-branch="master":
    git subtree pull --prefix=skills pi-skills {{skills-branch}}

update-extensions extensions-branch="main":
    git subtree pull --prefix=extensions pi-extensions {{extensions-branch}}

update-themes:
    mkdir -p themes
    curl -fsSL https://raw.githubusercontent.com/zenobi-us/pi-rose-pine/main/themes/rose-pine-main.json -o themes/rose-pine.json
    curl -fsSL https://raw.githubusercontent.com/zenobi-us/pi-rose-pine/main/themes/rose-pine-dawn.json -o themes/rose-pine-dawn.json
