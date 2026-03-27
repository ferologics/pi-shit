default:
    @just --list

check: fmt skills-check extensions-check release-config-check

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

release-config-check:
    node scripts/release.mjs --validate

# Release automation (version bumps + mirror publish + GitHub releases; npm publish via trusted workflows).
release target bump="patch":
    just check
    node scripts/release.mjs --target {{target}} --bump {{bump}}

release-dry target bump="patch":
    node scripts/release.mjs --target {{target}} --bump {{bump}} --dry-run

# Primary flow: edit in pi-shit, then publish mirrors.
publish:
    @just publish-skills
    @just publish-extensions
    @just publish-pi-deep-review
    @just publish-pi-ghostty-hunk
    @just publish-pi-ghostty-lazygit
    @just publish-pi-notify
    @just publish-pi-system-theme
    @just publish-pi-verbosity-control

publish-skills skills-branch="master":
    git subtree push --prefix=skills pi-skills {{skills-branch}}

publish-extensions extensions-branch="main":
    git subtree push --prefix=extensions pi-extensions {{extensions-branch}}

publish-pi-deep-review pi-deep-review-branch="main":
    git subtree push --prefix=extensions/deep-review git@github.com:ferologics/pi-deep-review.git {{pi-deep-review-branch}}

publish-pi-ghostty-hunk pi-ghostty-hunk-branch="main":
    git subtree push --prefix=extensions/pi-ghostty-hunk git@github.com:ferologics/pi-ghostty-hunk.git {{pi-ghostty-hunk-branch}}

publish-pi-ghostty-lazygit pi-ghostty-lazygit-branch="main":
    git subtree push --prefix=extensions/pi-ghostty-lazygit git@github.com:ferologics/pi-ghostty-lazygit.git {{pi-ghostty-lazygit-branch}}

publish-pi-notify pi-notify-branch="master":
    git subtree push --prefix=extensions/pi-notify git@github.com:ferologics/pi-notify.git {{pi-notify-branch}}

publish-pi-system-theme pi-system-theme-branch="main":
    git subtree push --prefix=extensions/pi-system-theme git@github.com:ferologics/pi-system-theme.git {{pi-system-theme-branch}}

publish-pi-verbosity-control pi-verbosity-control-branch="main":
    git subtree push --prefix=extensions/pi-verbosity-control git@github.com:ferologics/pi-verbosity-control.git {{pi-verbosity-control-branch}}

# Repair flow: pull one-off direct downstream edits back into pi-shit.
repair-pull:
    @just pull-skills
    @just pull-extensions
    @just update-themes
    @just regen-manifest

pull-skills skills-branch="master":
    git subtree pull --prefix=skills pi-skills {{skills-branch}}

pull-extensions extensions-branch="main" pi-deep-review-branch="main" pi-ghostty-hunk-branch="main" pi-ghostty-lazygit-branch="main" pi-notify-branch="master" pi-system-theme-branch="main" pi-verbosity-control-branch="main":
    git subtree pull --prefix=extensions pi-extensions {{extensions-branch}}
    just pull-pi-deep-review pi-deep-review-branch={{pi-deep-review-branch}}
    just pull-pi-ghostty-hunk pi-ghostty-hunk-branch={{pi-ghostty-hunk-branch}}
    just pull-pi-ghostty-lazygit pi-ghostty-lazygit-branch={{pi-ghostty-lazygit-branch}}
    just pull-pi-notify pi-notify-branch={{pi-notify-branch}}
    just pull-pi-system-theme pi-system-theme-branch={{pi-system-theme-branch}}
    just pull-pi-verbosity-control pi-verbosity-control-branch={{pi-verbosity-control-branch}}

pull-pi-deep-review pi-deep-review-branch="main":
    git subtree pull --prefix=extensions/deep-review git@github.com:ferologics/pi-deep-review.git {{pi-deep-review-branch}}

pull-pi-ghostty-hunk pi-ghostty-hunk-branch="main":
    git subtree pull --prefix=extensions/pi-ghostty-hunk git@github.com:ferologics/pi-ghostty-hunk.git {{pi-ghostty-hunk-branch}}

pull-pi-ghostty-lazygit pi-ghostty-lazygit-branch="main":
    git subtree pull --prefix=extensions/pi-ghostty-lazygit git@github.com:ferologics/pi-ghostty-lazygit.git {{pi-ghostty-lazygit-branch}}

pull-pi-notify pi-notify-branch="master":
    git subtree pull --prefix=extensions/pi-notify git@github.com:ferologics/pi-notify.git {{pi-notify-branch}}

pull-pi-system-theme pi-system-theme-branch="main":
    git subtree pull --prefix=extensions/pi-system-theme git@github.com:ferologics/pi-system-theme.git {{pi-system-theme-branch}}

pull-pi-verbosity-control pi-verbosity-control-branch="main":
    git subtree pull --prefix=extensions/pi-verbosity-control git@github.com:ferologics/pi-verbosity-control.git {{pi-verbosity-control-branch}}

update-themes:
    mkdir -p themes
    curl -fsSL https://raw.githubusercontent.com/zenobi-us/pi-rose-pine/main/themes/rose-pine-main.json -o themes/rose-pine.json
    curl -fsSL https://raw.githubusercontent.com/zenobi-us/pi-rose-pine/main/themes/rose-pine-dawn.json -o themes/rose-pine-dawn.json
