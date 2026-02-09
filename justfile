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

update-skills skills-branch="master":
    git subtree pull --prefix=skills pi-skills {{skills-branch}}

update-extensions extensions-branch="main":
    git subtree pull --prefix=extensions pi-extensions {{extensions-branch}}
