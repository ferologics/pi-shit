default:
    @just --list

update:
    @just update-skills
    @just update-extensions

update-skills skills-branch="master":
    git subtree pull --prefix=skills pi-skills {{skills-branch}}

update-extensions extensions-branch="feat/deep-review-extension":
    git subtree pull --prefix=extensions pi-extensions {{extensions-branch}}

