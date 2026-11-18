# Première publication sur GitHub Pages

1. Décompresser le paquet `acc-parcours-github-compact.zip`. **Garder l’archive intérieure `data/parcours.zip` compressée**. Elle contient les 54 parcours de départ (32 route et 22 gravel), leurs profils et les revêtements disponibles.
2. Dans un dépôt GitHub sur la branche `main`, déposer **le contenu du dossier** `acc-parcours`. À la racine du dépôt, on doit voir `index.html`, `data/`, `tools/`, `tests/` et `.github/`. Sur Mac, **⌘ Maj .** affiche les fichiers cachés dans le Finder.
3. Dans **Settings → Pages → Source**, choisir **GitHub Actions**. Dans **Actions → Ajouter les parcours et publier → Run workflow**, choisir `main` et lancer la publication.
4. Une fois la publication terminée, récupérer l’adresse dans **Settings → Pages**. Pour intégrer le catalogue au site du club, utiliser cette adresse comme destination du lien « Parcours ».


## Si GitHub affiche « This file is hidden »

Envoyer les fichiers visibles, puis utiliser **Add file → Create new file** depuis la racine du dépôt. Saisir le chemin complet `.github/workflows/pages.yml`, coller le contenu du fichier correspondant du paquet et enregistrer sur `main`. Recommencer avec `.github/workflows/tests.yml`. Sur Mac, **⌘ Maj .** permet de retrouver ces fichiers dans le Finder.
