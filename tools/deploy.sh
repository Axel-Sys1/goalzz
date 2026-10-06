#!/bin/sh
# Met le site en ligne : enregistre tous les changements et les envoie sur GitHub.
# Cloudflare Pages republie goalzz.pages.dev automatiquement après chaque envoi.
# Usage : ./tools/deploy.sh "ce qui a changé"
set -e
cd "$(dirname "$0")/.."
git add -A
if git diff --cached --quiet; then
  echo "Rien à publier."
else
  git commit -q -m "${1:-Mise à jour du site}"
fi
git push -q origin main
echo "Publié : https://goalzz.pages.dev (en ligne d'ici une minute)."
