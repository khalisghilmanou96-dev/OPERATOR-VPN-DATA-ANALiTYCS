# Network Analytics Dashboard — module d’intégration

Module Node.js/Express permettant à un site de mesurer de façon agrégée la répartition des visites par **opérateur Internet** et par **utilisation d’un VPN (Oui/Non)**. Le dashboard administrateur est protégé par un token personnel.

> Le module ne stocke pas l’adresse IP ni le User-Agent dans MySQL. L’IP est utilisée temporairement côté serveur pour classifier le réseau, puis seuls les compteurs agrégés sont enregistrés.

## Fonctionnement

1. Le visiteur charge une page de votre site.
2. Le script d’intégration appelle `POST /network-analytics/checkin` une fois par session d’onglet.
3. Le backend obtient temporairement l’IP de la connexion et interroge le fournisseur IP configuré.
4. Le backend incrémente uniquement deux statistiques MySQL : opérateur et VPN Oui/Non.
5. Le dashboard lit ces agrégats via `GET /network-analytics/dashboard`, protégé par `ADMIN_TOKEN`.

### Retour d’un visiteur

Le script utilise `sessionStorage`. Un rechargement ou une navigation dans le **même onglet** ne crée donc pas un nouveau comptage. Lorsque l’onglet/la session de navigation est fermé(e), `sessionStorage` est normalement supprimé par le navigateur. Un retour ultérieur dans une nouvelle session déclenche alors un nouveau check-in.

Une déconnexion de votre **compte utilisateur** ne supprime pas automatiquement `sessionStorage` si le même onglet reste ouvert. Si votre site possède une fonction de déconnexion et que vous souhaitez qu’une reconnexion dans le même onglet soit comptée comme une nouvelle visite, exécutez lors du logout :

```js
sessionStorage.removeItem("networkAnalyticsChecked");
```

Les statistiques déjà enregistrées restent dans MySQL après la déconnexion, la fermeture du navigateur ou le redémarrage du serveur.

## 1. Prérequis

- Node.js 18+
- Backend Node.js/Express
- Base MySQL locale ou distante
- Token IPinfo donnant accès aux informations ASN/opérateur et à la détection VPN nécessaire à votre formule

Il n’est pas nécessaire d’installer MySQL sur votre ordinateur si votre hébergeur fournit déjà une base MySQL.

## 2. Installation

Copiez dans votre backend :

```text
networkAnalytics.js
schema.sql
```

Puis installez les dépendances :

```bash
npm install express mysql2 dotenv
```

## 3. Créer le token personnel du dashboard

`ADMIN_TOKEN` est le secret qui autorise la lecture des métriques. Il doit être long, aléatoire, conservé côté serveur et ne jamais être placé dans le JavaScript public ou envoyé sur GitHub.

### macOS / Linux

```bash
openssl rand -hex 32
```

### Windows PowerShell

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
($bytes | ForEach-Object ToString x2) -join ''
```

### Toutes plateformes avec Node.js

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiez le résultat dans `.env` :

```env
ADMIN_TOKEN=COLLEZ_ICI_VOTRE_TOKEN_ALEATOIRE
```

Ce token est demandé dans `dashboard.html`. Le navigateur l’envoie dans :

```text
Authorization: Bearer VOTRE_ADMIN_TOKEN
```

Pour changer l’accès au dashboard, générez simplement un nouveau token, remplacez `ADMIN_TOKEN` côté serveur puis redémarrez l’application.

## 4. Configuration `.env`

Créez le fichier à partir de `.env.example` :

macOS/Linux :

```bash
cp .env.example .env
```

Windows CMD :

```cmd
copy .env.example .env
```

Exemple :

```env
PORT=3000
TRUST_PROXY=1
ADMIN_TOKEN=votre_token_admin_aleatoire
IPINFO_TOKEN=votre_token_ipinfo
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=ip_dashboard_user
MYSQL_PASSWORD=votre_mot_de_passe_mysql
MYSQL_DATABASE=ip_dashboard
MYSQL_SSL=false
```

`ADMIN_TOKEN` et `IPINFO_TOKEN` sont deux secrets différents : le premier protège votre dashboard ; le second authentifie votre serveur auprès du fournisseur IP.

## 5. Créer les tables MySQL

`schema.sql` crée uniquement :

- `operator_stats` : nom de l’opérateur + compteur ;
- `vpn_stats` : VPN Oui/Non + compteur.

Aucune colonne ne stocke l’adresse IP.

Avec le client MySQL :

```bash
mysql -h VOTRE_HOTE -u VOTRE_UTILISATEUR -p < schema.sql
```

Avec phpMyAdmin/Adminer ou la console SQL de votre hébergeur, importez simplement `schema.sql`.

## 6. Intégrer le backend

Dans votre application Express :

```js
import "dotenv/config";
import express from "express";
import { createNetworkAnalytics } from "./networkAnalytics.js";

const app = express();

// À adapter à votre hébergeur/reverse proxy.
app.set("trust proxy", 1);

const analytics = createNetworkAnalytics();
app.use("/network-analytics", analytics.router);
```

Le module expose :

```text
POST /network-analytics/checkin
GET  /network-analytics/dashboard
```

`GET /dashboard` nécessite `Authorization: Bearer <ADMIN_TOKEN>`.

## 7. Script à intégrer aux pages du site

Ajoutez ce script avant `</body>` sur les pages à mesurer :

```html
<script>
window.addEventListener("DOMContentLoaded", async () => {
  if (sessionStorage.getItem("networkAnalyticsChecked")) return;

  try {
    const response = await fetch("/network-analytics/checkin", {
      method: "POST",
      credentials: "same-origin"
    });

    if (response.ok) {
      sessionStorage.setItem("networkAnalyticsChecked", "1");
    }
  } catch (error) {
    console.error("Network analytics indisponible :", error);
  }
});
</script>
```

Le même code est disponible dans `public/network-analytics-loader.js`. Si ce fichier est servi par votre application :

```html
<script src="/network-analytics-loader.js" defer></script>
```

Le script public ne doit contenir **ni `ADMIN_TOKEN`, ni `IPINFO_TOKEN`, ni identifiants MySQL**.

## 8. Dashboard administrateur

`public/dashboard.html` contient uniquement les deux camemberts :

- répartition par opérateur Internet ;
- VPN : Oui / Non.

L’administrateur saisit son `ADMIN_TOKEN` dans le champ prévu. Le dashboard appelle ensuite l’endpoint protégé.

Test en ligne de commande :

```bash
curl http://localhost:3000/network-analytics/dashboard \
  -H "Authorization: Bearer VOTRE_ADMIN_TOKEN"
```

Exemple de réponse :

```json
{
  "operators": [
    { "name": "Orange", "value": 120 },
    { "name": "Free", "value": 80 }
  ],
  "vpn": {
    "yes": 25,
    "no": 175
  }
}
```

## 9. Serveur d’exemple

`server.js` est uniquement un exemple pour tester le module seul :

```bash
npm install
cp .env.example .env
npm start
```

Dashboard :

```text
http://localhost:3000/dashboard.html
```

Il n’y a volontairement plus de `index.html` : sur un vrai site, le déclencheur est intégré directement dans les pages existantes.

## 10. Sécurité et confidentialité

- Ne commitez jamais `.env`.
- Utilisez HTTPS en production.
- Ne mettez jamais les tokens ou identifiants MySQL dans le frontend.
- Configurez `trust proxy` en fonction de votre hébergeur ; une mauvaise configuration peut rendre `req.ip` non fiable.
- Ajoutez une limitation de débit/anti-abus adaptée à votre infrastructure.
- Le token du dashboard protège l’API de métriques, mais une authentification administrateur existante de votre site reste préférable en production.
- Adaptez le consentement, l’information des visiteurs, la durée de conservation des statistiques et votre politique de confidentialité aux lois/règles applicables à votre site.

## Structure

```text
ip-network-dashboard/
├── networkAnalytics.js
├── server.js                 # exemple uniquement
├── schema.sql
├── .env.example
├── package.json
├── README.md
├── READLICENSE
└── public/
    ├── network-analytics-loader.js
    └── dashboard.html
```

## Autres backends

Le fichier `networkAnalytics.js` est directement intégrable à Node.js + Express. Pour PHP/Laravel/Symfony, Python/Django/Flask, Ruby/Rails, Java/Spring ou un autre backend, le principe reste le même mais la logique serveur doit être portée dans le langage concerné : récupérer l’IP côté serveur, effectuer la classification, puis incrémenter les deux compteurs SQL.

## Licence

Voir `READLICENSE`. Cette distribution est proposée sous licence propriétaire : aucune autorisation générale de copie, redistribution, revente ou création de dérivés n’est accordée en dehors des permissions explicitement données par le titulaire des droits.
