# ACC Bordeaux · Ajouter une trace GPX

Pour ajouter une sortie au catalogue du club, il te faut le fichier `.gpx` du parcours et un accès en écriture au dépôt. Tu peux tout faire depuis ton navigateur.

## 1. Choisis la pratique

Exporte la trace au format GPX depuis Strava, puis ouvre l’un des dossiers ci-dessous. Le dossier choisi détermine le filtre sous lequel les cyclistes retrouveront le parcours.

| Pratique | Dossier de dépôt |
| --- | --- |
| Route | [Ajouter une trace route](data/gpx/route/) |
| Gravel | [Ajouter une trace gravel](data/gpx/gravel/) |
| VTT | [Ajouter une trace VTT](data/gpx/vtt/) |

## 2. Dépose le GPX

1. Dans le dossier choisi, clique sur **Add file → Upload files**.
2. Glisse ton fichier dans la fenêtre. Tu peux déposer plusieurs GPX ensemble s’ils relèvent de la même pratique. Pour une nouvelle sortie, utilise un nom de fichier libre dans ce dossier afin de conserver les traces déjà présentes.
3. Saisis un message court, par exemple *Ajout de la sortie gravel de Cestas*. Enregistre sur la branche `main` avec **Commit changes**.

Le site se met à jour automatiquement. Tu peux conserver le nom donné par Strava et laisser l’archive `data/parcours.zip` telle quelle.

## 3. Vérifie le parcours

Dans l’onglet **Actions**, ouvre l’exécution **Ajouter les parcours et publier** qui porte ton message. Quand elle affiche une coche verte, ouvre le catalogue, sélectionne la pratique et repère la sortie par sa distance et son dénivelé. Clique sur sa fiche pour vérifier le tracé sur la carte.

Le fichier téléchargeable reçoit un nom comme `08112026_gravel_41km_204d.gpx` pour une trace ajoutée le 8 novembre 2026, de 41 km et 204 m de dénivelé positif. Les kilomètres et le dénivelé sont arrondis à l’entier.

### Si la sortie n’apparaît pas

- **La publication est en cours.** Attends la coche verte dans **Actions**, puis recharge le catalogue.
- **La publication a réussi.** Réinitialise les filtres. Si la même pratique contient déjà les mêmes points GPS dans les mêmes segments et dans le même ordre, le catalogue conserve une seule fiche, même si les deux fichiers portent des noms différents.
- **La publication a échoué.** Ouvre l’étape en rouge dans **Actions**. Si elle signale un GPX invalide, exporte à nouveau la trace et remplace le fichier concerné dans son dossier. Enregistrer la correction sur `main` relance la publication.
