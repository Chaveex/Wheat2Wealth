# Wheat2Wealth — version Next.js

Version en ligne du jeu, avec de vrais comptes (pseudo + mot de passe) et un
classement partagé entre tous les joueurs, hébergée sur Vercel avec une base
de données Supabase.

**Ce qui est inclus dans cette première version (le "cœur" du jeu) :**
- Grille de 36 parcelles, achat/semis/récolte/vente
- 3 technologies : irrigation, graines sélectionnées, silo agrandi
- Comptes avec pseudo + mot de passe, sauvegarde liée au compte
- Classement des meilleurs scores, visible par tous

**Ce qui n'est pas encore porté** (ça viendra par-dessus cette base une fois
qu'elle tourne bien en ligne) : ouvrier/semeur automatiques, moissonneuse,
semoir mécanique, courtier automatique, système de revente/agrandissement
d'exploitation, statistiques détaillées, 3 langues.

## 1. Créer le projet Supabase (gratuit)

1. Va sur [supabase.com](https://supabase.com) et crée un compte.
2. Crée un nouveau projet (choisis un mot de passe de base de données — tu
   n'en auras pas besoin directement, note-le quelque part au cas où).
3. Une fois le projet créé, ouvre **SQL Editor** dans le menu de gauche,
   colle le contenu du fichier `supabase-schema.sql` fourni ici, et clique
   sur **Run**. Ça crée les deux tables nécessaires (`accounts` et `saves`).
4. Va dans **Project Settings > API**. Tu auras besoin de deux valeurs :
   - **Project URL** (ex. `https://xxxxx.supabase.co`)
   - **service_role key** (dans "Project API keys" — clique sur "Reveal" à
     côté de `service_role`, PAS `anon`/`public`)

   ⚠️ La clé `service_role` donne un accès total à la base sans restriction.
   Ne la mets jamais dans du code qui s'exécute dans le navigateur — dans ce
   projet, elle n'est utilisée que côté serveur (dossier `app/api/`), jamais
   dans `page.js`.

## 2. Générer un secret de session

Dans un terminal (Mac/Linux) :
```
openssl rand -base64 32
```
Sur Windows (PowerShell) :
```
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```
Garde la valeur générée, c'est ton `SESSION_SECRET`.

## 3. Tester en local (optionnel mais recommandé)

```
npm install
cp .env.example .env.local
```
Ouvre `.env.local` et remplace les 3 valeurs par les tiennes (Supabase URL,
service role key, session secret). Puis :
```
npm run dev
```
Ouvre [http://localhost:3000](http://localhost:3000) — tu devrais voir
l'écran de connexion.

## 4. Déployer sur Vercel (gratuit)

1. Mets ce projet sur GitHub (crée un nouveau dépôt, pousse le code).
2. Va sur [vercel.com](https://vercel.com), connecte-toi avec GitHub.
3. "Add New… > Project", choisis ton dépôt.
4. Avant de cliquer sur Deploy, ouvre **Environment Variables** et ajoute
   les 3 mêmes variables que dans `.env.local` (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`).
5. Clique sur **Deploy**. Au bout de 1-2 minutes, Vercel te donne une URL du
   type `wheat2wealth.vercel.app` — c'est le lien à partager avec tes amis.

## Limites connues de cette version (à avoir en tête)

- **Pas de vraie confirmation d'email** : n'importe qui peut créer un compte
  avec n'importe quel pseudo libre. Suffisant pour jouer entre amis.
- **Le serveur fait confiance à l'état envoyé par le client** pour la
  sauvegarde (il ne revérifie pas que chaque action était légitime). Pour un
  jeu entre amis ce n'est pas grave ; si le jeu devient public, il faudrait
  ajouter une validation côté serveur des actions plutôt que de la partie
  entière.
- Un joueur un peu bidouilleur pourrait modifier l'état envoyé au serveur
  depuis les outils de développement de son navigateur pour tricher sur son
  score. Encore une fois : acceptable pour un classement entre amis, pas
  pour un vrai jeu compétitif public.

## Prochaines étapes suggérées

Une fois que ça tourne bien en ligne avec tes amis, on peut ajouter par-dessus
(dans cet ordre suggéré) : les 5 technologies avancées, l'ouvrier/semeur
automatiques, puis les machines (moissonneuse/semoir), le courtier, et enfin
le système de revente/agrandissement d'exploitation.
