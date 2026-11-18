# Les parcours de l’ACC Bordeaux

Catalogue public des parcours route, gravel et VTT du club. Les cyclistes peuvent comparer les parcours en grille ou en liste, filtrer par pratique, distance ou dénivelé, puis ouvrir une fiche pour explorer la carte, suivre les montées sur le profil et télécharger le GPX.

## Publier pour la première fois

1. Décompresser le paquet `acc-parcours-github-compact.zip`. **Garder l’archive intérieure `data/parcours.zip` compressée**. Elle contient les 54 parcours de départ (32 route et 22 gravel), leurs profils et les revêtements disponibles.
2. Dans un dépôt GitHub sur la branche `main`, déposer **le contenu du dossier** `acc-parcours`. À la racine du dépôt, on doit voir `index.html`, `data/`, `tools/`, `tests/` et `.github/`. Sur Mac, **⌘ Maj .** affiche les fichiers cachés dans le Finder.
3. Dans **Settings → Pages → Source**, choisir **GitHub Actions**. Dans **Actions → Ajouter les parcours et publier → Run workflow**, choisir `main` et lancer la publication.
4. Une fois la publication terminée, récupérer l’adresse dans **Settings → Pages**. Pour intégrer le catalogue au site du club, utiliser cette adresse comme destination du lien « Parcours ».

## Ajouter un parcours depuis GitHub

1. Ouvrir `data/gpx/route/`, `data/gpx/gravel/` ou `data/gpx/vtt/` selon la pratique.
2. Choisir **Add file → Upload files**, déposer le ou les GPX exportés depuis Strava, puis enregistrer sur `main`. Pour un nouveau parcours, choisir un nom de fichier encore libre dans ce dossier.
3. Suivre la publication dans **Actions**. GitHub décompresse la base, lit les nouveaux GPX, calcule les statistiques et publie le catalogue. Chaque GPX devient téléchargeable individuellement.

L’archive de départ peut rester telle quelle pour tous les ajouts courants. Pour retirer un parcours ajouté séparément, supprimer son GPX du dossier de pratique et enregistrer la modification.

### Noms et doublons

Le nom publié est aussi le nom téléchargé. Par exemple, `08112026_gravel_41km_204d.gpx` désigne un gravel ajouté le 8 novembre 2026, de 41 km et 204 m de dénivelé positif. La date suit le format JJMMAAAA. Pour les ajouts GitHub, elle vient du commit d’ajout. En aperçu local, un GPX sans historique utilise sa date de modification. Les valeurs du nom sont arrondies à l’entier. Un dénivelé inconnu donne `NAd`.

Dans une même pratique, deux GPX avec les mêmes coordonnées, dans les mêmes segments et dans le même ordre, comptent pour un seul parcours. Un enregistrement GPS légèrement différent ou parcouru en sens inverse constitue une trace distincte. Si deux parcours distincts donnent le même nom arrondi, un identifiant supplémentaire évite d’écraser un fichier.

## Vérifier le site en local

Depuis la racine du projet, avec Python 3.12 (version utilisée par GitHub) :

```sh
python3 tools/prepare_site.py
python3 -m http.server 8000 --directory _site
```

Ouvrir **http://localhost:8000**. Relancer la préparation après chaque modification. Le dossier `_site/` est recréé à chaque fois. Les changements se font donc dans les fichiers sources à la racine. Les fonds de carte distants nécessitent une connexion Internet.

Pour lancer les tests, utiliser Python et Node.js 22 :

```sh
python3 -m unittest discover -s tools -p 'test_*.py'
node --test tests/app.test.cjs
```

## Où intervenir dans le code

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css`, `app.js` | Interface, filtres, vues grille et liste, carte et profil interactif |
| `tools/prepare_site.py` | Préparation du site à partir de l’archive et des ajouts |
| `tools/build_catalog.py` | Lecture des GPX, calcul des statistiques et des profils, noms et doublons |
| `tools/enrich_surfaces.py` | Estimation facultative des revêtements à partir des données OpenStreetMap |
| `.github/workflows/` | Tests des modifications proposées et publication des changements de la branche principale |

## Si un parcours manque

Vérifier d’abord les filtres du catalogue, puis l’état de la dernière publication dans **Actions**. Un ajout peut aussi correspondre à un tracé déjà présent. Si la préparation échoue, ouvrir l’étape en erreur pour retrouver le fichier concerné. Le lecteur attend une trace GPX avec au moins deux points de trace et des coordonnées valides. Corriger le fichier sur `main` déclenche une nouvelle publication.

Le dénivelé correspond à la somme des montées entre points successifs. Il peut différer du chiffre lissé de Strava. Les revêtements sont des estimations facultatives, consultables sur les parcours enrichis.
