# Spécification — Statut automatique des salons vocaux

**Statut :** proposition à valider  
**Version :** 0.3  
**Date :** 2026-11-06  
**Périmètre :** salons vocaux Discord d’une guild

## 1. Résumé

Le bot maintient automatiquement le statut textuel d’un salon vocal selon son contexte : membres présents, activités multimédia détectées et règles configurées par l’équipe du serveur.

Un statut défini explicitement par un utilisateur est prioritaire sur toute automatisation. Le bot ne doit jamais remplacer un statut manuel tant qu’il est verrouillé, même si une activité multimédia différente est détectée.

## 2. Objectifs

- Donner une indication utile et vivante sur l’usage d’un salon vocal.
- Détecter les activités multimédia visibles chez les membres présents.
- Ne jamais écraser silencieusement une décision humaine.
- Éviter les mises à jour répétitives et les changements de statut trop fréquents.
- Permettre une configuration par salon, par catégorie ou par guild.
- Garder une architecture extensible pour ajouter d’autres sources que PreMiD.

## 3. Hors périmètre

- Modifier le nom, la catégorie ou les permissions du salon.
- Lire directement les données locales de l’extension PreMiD.
- Garantir la détection d’une activité que Discord ne transmet pas au bot.
- Déduire avec certitude l’identité d’un utilisateur ayant changé le statut si l’événement Discord ne fournit pas cette information.
- Remplacer le statut global du bot.

## 4. Terminologie

- **Statut de salon :** texte associé au salon vocal et modifiable indépendamment de son nom.
- **Statut manuel :** valeur définie par un utilisateur ou par une commande explicite.
- **Statut automatique :** valeur calculée par le moteur.
- **Source :** origine de la valeur automatique (`media`, `default`, `empty`, etc.).
- **Verrou manuel :** état qui interdit au moteur de modifier le statut.
- **Activité média :** activité Discord représentant par exemple YouTube, Netflix, Twitch ou Spotify.

## 5. Règles fonctionnelles

### 5.1 Priorité des sources

La résolution suit cette priorité :

1. Statut manuel verrouillé.
2. Statut automatique verrouillé par configuration.
3. Catégorie d’activité dominante selon les seuils configurés.
4. Statut par défaut du salon, uniquement s’il est configuré comme utile dans ce contexte.
5. Aucun statut.

Une exception contrôlée existe pour les messages de bienvenue temporaires : ils peuvent remplacer momentanément le statut courant, y compris un statut manuel, à condition que la fonctionnalité soit activée et que la valeur originale soit restaurée sans écraser une nouvelle modification humaine.

### 5.1 Réinitialisation lorsque le salon est vide

Lorsque le dernier membre quitte le salon vocal, le statut et son état runtime sont automatiquement réinitialisés. Cette règle est une exception au verrou manuel : un statut manuel est également supprimé lorsque le salon est vide, afin qu’il ne reste pas bloqué pour la prochaine session.

La réinitialisation :

- supprime le statut du salon si le bot possède les permissions nécessaires ;
- annule un overlay de bienvenue encore actif ;
- supprime `manualLocked` et `manualValue` ;
- supprime la dernière activité et le fingerprint associé ;
- remet à zéro les timestamps de synchronisation et les erreurs temporaires ;
- conserve la configuration persistante du salon, de sa catégorie et de sa guild.

Le reset est déclenché après `emptyResetDelaySeconds`, fixé à 5 secondes par défaut, pour éviter un reset pendant un déplacement immédiat d’un membre vers un autre salon. Si quelqu’un rejoint avant l’expiration du délai, le reset est annulé.

Le moteur ne modifie Discord que si la valeur résolue est différente de la dernière valeur connue.

### 5.2 Détection d’un statut manuel

Le bot mémorise chaque valeur qu’il écrit ainsi que son origine. Lorsqu’un événement indique une nouvelle valeur :

- si elle correspond à la dernière valeur écrite par le bot, elle reste automatique ;
- si elle diffère de cette valeur, elle est considérée comme manuelle et le salon est verrouillé ;
- si le statut est supprimé manuellement, le verrou manuel reste actif et la valeur devient vide jusqu’à déverrouillage explicite.

Si Discord ne permet pas d’identifier l’auteur de la modification, cette détection est une heuristique. Le système doit exposer une commande permettant de corriger l’état : `unlock`, `force` ou `reset`.

### 5.3 Activités multimédia et jeux

Une activité n’est éligible que si :

- le membre est actuellement dans le salon concerné ;
- le provider est activé pour ce salon ;
- l’activité contient au minimum un nom de provider ou un titre exploitable ;
- l’activité n’est pas expirée.

Les activités des membres absents du salon sont ignorées.

Les activités sont classées en deux familles principales :

- `media` : YouTube, Netflix, Twitch, Spotify et providers similaires ;
- `game` : jeux détectés dans les activités Discord.

Un salon peut autoriser une seule famille ou les deux. Les activités non reconnues sont ignorées.

#### Seuil de dominance

Une activité de jeu ne doit pas prendre le dessus dans un salon multigaming simplement parce qu’un seul membre joue à ce jeu. La décision doit utiliser au minimum :

- `minMembers` : nombre minimal de membres partageant l’activité ;
- `minShare` : proportion minimale des membres actifs dans le salon ;
- `minConfidence` : score minimal de confiance de la détection, si disponible.

Une activité est dominante si elle satisfait tous les seuils activés. Les membres sans activité reconnue ne comptent pas dans `minShare` si `shareDenominator` vaut `activeMembers`, et comptent dans le total du salon si la valeur vaut `voiceMembers`.

Configuration recommandée pour un salon multigaming :

```js
{
  gameDetection: {
    enabled: true,
    minMembers: 2,
    minShare: 0.5,
    shareDenominator: 'activeMembers',
    genericStatus: '🎮 Multigaming'
  }
}
```

Ainsi, un jeu joué par une seule personne ne devient pas automatiquement le statut du salon. Si aucun jeu ne franchit le seuil, le moteur ne met par défaut aucun statut de jeu. Le statut optionnel `🎮 Multigaming` ne peut être utilisé que si `genericStatus` est explicitement configuré.

### 5.4 Modes d’affichage des jeux

Le setup du salon doit proposer explicitement le comportement à appliquer lorsqu’un jeu atteint le seuil :

- `priority` : afficher le jeu dominant ;
- `none` : ne rien afficher pour les jeux ;
- `generic` : utiliser le texte générique configuré ;
- `summary` : afficher les jeux retenus, par exemple `🎮 Minecraft | League of Legends`.

Le mode par défaut est `none`. Un statut de jeu ne doit donc jamais apparaître simplement parce qu’une activité de jeu est disponible.

### 5.5 Priorité entre média et jeux

La priorité entre familles doit être configurable plutôt que codée en dur. Les politiques proposées sont :

- `media-first` : une activité média dominante est prioritaire ;
- `game-first` : un jeu dominant est prioritaire ;
- `dominant` : la famille ayant le plus grand nombre de membres éligibles gagne ;
- `mixed` : le statut résume les deux familles, uniquement si les deux familles sont suffisamment représentées ;
- `configured` : ordre fourni explicitement par la configuration.

Valeur recommandée : `dominant`, avec un seuil minimum de deux membres pour les jeux. En cas d’égalité, appliquer l’ordre configuré. Si aucune famille ne justifie un statut, ne rien afficher plutôt que produire un résumé générique.

### 5.6 Plusieurs activités

Le comportement par défaut est l’agrégation :

- une seule activité : afficher le titre ;
- plusieurs activités identiques : afficher le titre et le nombre de personnes ;
- plusieurs activités média différentes : afficher un résumé court basé sur les titres, sans privilégier le nom de l’auteur ;
- un film ou une série : privilégier le titre du contenu plutôt que l’auteur, la chaîne ou le créateur ;
- plusieurs activités différentes : afficher un résumé court, par exemple `Interstellar · The Office` ;
- plusieurs jeux sans activité dominante : ne rien afficher par défaut ; afficher `🎮 Multigaming` uniquement si l’option est explicitement activée ;
- un jeu dominant et d’autres jeux minoritaires : afficher le jeu dominant, éventuellement avec le nombre de participants ;
- si le texte dépasse la limite autorisée par Discord : utiliser un résumé sans titres, puis tronquer proprement en dernier recours.

Une configuration `aggregationMode` pourra proposer `first`, `count`, `summary` ou `custom`.

Le principe général est `useful-only` : un statut n’est écrit que s’il apporte une information exploitable. En particulier, le moteur ne doit pas publier un statut générique uniquement pour signaler qu’il n’a pas trouvé de statut plus précis.

### 5.5 Absence d’activité

Quand aucune activité éligible n’est détectée :

- appliquer le statut par défaut s’il existe ;
- sinon supprimer le statut si `clearWhenEmpty` est activé ;
- sinon conserver le dernier statut automatique pendant la durée de `staleAfter` ;
- après expiration, supprimer le statut automatique.

Un statut manuel n’est jamais supprimé par ces règles.

### 5.7 Temporisation et rotation

Le moteur applique :

- un délai de stabilité avant changement (`debounce`, 10 secondes par défaut) ;
- un intervalle minimal entre deux écritures Discord (`minUpdateInterval`, 30 secondes par défaut) ;
- une rotation optionnelle du statut automatique toutes les 30 secondes lorsqu’il existe plusieurs valeurs pertinentes ;
- la disparition d’un statut devenu obsolète après quelques secondes ou après la durée `staleAfter` ;
- une réconciliation périodique pour récupérer les événements manqués ;
- une écriture immédiate uniquement lors d’un `force` explicite.

### 5.8 Message de bienvenue temporaire

Lorsqu’un membre rejoint un salon vocal configuré pour cette fonctionnalité, le bot peut afficher un court message dans le statut du salon, par exemple :

```text
👋 Bienvenue, Pierre !
```

Le message est un overlay temporaire, pas un nouveau statut permanent.

Règles :

- durée configurable entre 10 et 15 secondes, 12 secondes par défaut ;
- la valeur précédente est capturée avant l’écriture, qu’elle soit manuelle ou automatique ;
- à l’expiration, le bot restaure exactement la valeur précédente ;
- si plusieurs personnes rejoignent pendant l’overlay, les noms sont regroupés autant que possible ;
- au-delà de trois personnes regroupées, utiliser une phrase générique ou `{count}` selon `welcomeAggregationMode` ;
- si le statut est modifié par un utilisateur pendant l’overlay, le bot ne restaure pas l’ancienne valeur par-dessus cette modification ;
- si une activité ou un changement de configuration survient pendant l’overlay, la restauration est suivie d’une nouvelle résolution automatique uniquement si aucune modification humaine n’a été observée ;
- le message de bienvenue ne doit pas être déclenché lors d’une reconnexion ou d’une simple mise à jour de présence ;
- le déclenchement est ignoré si le salon est désactivé ou si la fonctionnalité `welcomeOverlay` est désactivée.

Configuration recommandée :

```js
{
  welcomeOverlay: {
    enabled: false,
    durationSeconds: 12,
    templates: [
      '👋 Bienvenue, {user} !',
      '🎉 {user} vient de rejoindre le salon !',
      '🙌 Content de te voir, {user} !'
    ],
    selectionMode: 'random',
    avoidImmediateRepeat: true,
    welcomeAggregationMode: 'group',
    maxGroupedUsers: 3,
    restoreManualStatus: true
  }
}
```

Les templates disponibles sont sélectionnés aléatoirement. Avec `avoidImmediateRepeat`, la phrase affichée précédemment est exclue du prochain tirage lorsqu’au moins deux variantes sont disponibles.

Les variables initialement supportées sont :

- `{user}` : nom d’affichage du membre ;
- `{username}` : nom d’utilisateur ;
- `{count}` : nombre de personnes ayant rejoint dans le regroupement courant ;
- `{channel}` : nom du salon vocal.

Si un template est invalide ou vide, il est ignoré. Si aucun template valide ne reste, l’overlay est abandonné sans modifier le statut. L’option est désactivée par défaut afin d’éviter de surcharger les statuts. Elle peut être activée indépendamment du moteur média/jeu.

### 5.9 Plages horaires silencieuses

Des plages horaires peuvent désactiver les statuts automatiques et/ou les overlays de bienvenue, par exemple pendant la nuit. Elles sont optionnelles et utilisent le fuseau horaire configuré par guild.

Pendant une plage silencieuse, aucune nouvelle écriture automatique ni aucun overlay de bienvenue n’est déclenché. Un statut manuel reste inchangé. À la fin de la plage, une réconciliation peut recalculer le statut si le salon est toujours actif.

### Poids de priorité des jeux

Chaque jeu peut recevoir un poids de priorité. Le poids est appliqué uniquement après les seuils de présence et de représentation : il ne peut donc pas rendre éligible un jeu qui ne respecte pas `minMembers` ou `minShare`.

```js
gameWeights: {
  '*': 1,
  'league-of-legends': 1.5,
  'minecraft': 1,
  'valorant': 0.75
}
```

Le score recommandé est :

```text
score = nombreDeParticipants × poidsDuJeu
```

Un poids supérieur à `1` favorise un jeu, un poids entre `0` et `1` le défavorise, et un poids de `0` l’exclut de la sélection automatique. En cas d’égalité, le plus grand nombre de participants gagne, puis le poids le plus élevé, puis l’ordre stable du résultat.

Les poids sont surchargeables par guild, catégorie et salon. Leur valeur par défaut est `1`.

## 6. Configuration

La configuration doit être surchargeable selon le niveau suivant :

```text
guild → catégorie → salon
```

La configuration du salon est prioritaire sur celle de sa catégorie. Une configuration absente au niveau du salon hérite de la catégorie, qui hérite elle-même des valeurs de la guild. La configuration doit être créée et modifiée avec une commande de setup.

Exemple :

```js
{
  guildId: String,
  channelId: String,
  categoryId: String,
  enabled: Boolean,
  mode: 'automatic' | 'manual' | 'hybrid',
  vocation: 'gaming' | 'chill' | 'work' | 'cinema' | 'music' | 'general' | 'custom',
  mediaEnabled: Boolean,
  providers: ['youtube', 'netflix', 'twitch', 'spotify'],
  activityFamilies: ['media', 'game'],
  activityPriority: 'dominant',
  gameStatusMode: 'priority' | 'none' | 'generic' | 'summary',
  gameThreshold: {
    minMembers: Number,
    minShare: Number,
    shareDenominator: 'activeMembers' | 'voiceMembers'
  },
  gameWeights: { '<normalized-game-id>': Number, '*': Number },
  gameDetection: {
    enabled: true,
    minMembers: 2,
    minShare: 0.5,
    shareDenominator: 'activeMembers',
    genericStatus: null
  },
  aggregationMode: 'first' | 'count' | 'summary',
  defaultStatus: String | null,
  clearWhenEmpty: Boolean,
  staleAfterSeconds: Number,
  debounceSeconds: Number,
  minUpdateIntervalSeconds: Number,
  statusRotationSeconds: Number,
  resetOnEmpty: Boolean,
  emptyResetDelaySeconds: Number,
  manualLock: Boolean,
  allowBotOverride: Boolean,
  quietHours: {
    enabled: Boolean,
    timezone: String,
    ranges: [{ start: 'HH:mm', end: 'HH:mm' }]
  }
}
```

Valeurs par défaut recommandées :

```js
{
  mode: 'hybrid',
  vocation: 'general',
  mediaEnabled: true,
  providers: ['youtube', 'netflix', 'twitch', 'spotify'],
  activityFamilies: ['media', 'game'],
  activityPriority: 'dominant',
  gameStatusMode: 'none',
  gameWeights: {
    '*': 1
  },
  gameThreshold: {
    minMembers: 2,
    minShare: 0.5,
    shareDenominator: 'activeMembers'
  },
  gameDetection: {
    enabled: true,
    minMembers: 2,
    minShare: 0.5,
    shareDenominator: 'activeMembers',
    genericStatus: null
  },
  aggregationMode: 'summary',
  clearWhenEmpty: true,
  staleAfterSeconds: 120,
  debounceSeconds: 10,
  minUpdateIntervalSeconds: 30,
  statusRotationSeconds: 30,
  resetOnEmpty: true,
  emptyResetDelaySeconds: 5,
  manualLock: true,
  allowBotOverride: false,
  quietHours: {
    enabled: false,
    timezone: 'Europe/Brussels',
    ranges: []
  },
  welcomeOverlay: {
    enabled: false,
    durationSeconds: 12,
    templates: [],
    selectionMode: 'random',
    avoidImmediateRepeat: true,
    welcomeAggregationMode: 'group',
    maxGroupedUsers: 3,
    restoreManualStatus: true
  }
}
```

### 6.1 Profils de vocation

La vocation est un préréglage d’intention, pas une contrainte technique : `gaming`, `chill`, `work`, `cinema`, `music`, `general` ou `custom`. Elle propose des valeurs par défaut adaptées, sans écraser une option explicitement configurée au niveau du salon.

## 7. Modèle d’état runtime

La configuration persistante et l’état de synchronisation doivent être séparés.

```js
{
  guildId,
  channelId,
  currentDiscordValue,
  lastBotValue,
  lastResolvedValue,
  source: 'manual' | 'media' | 'default' | 'empty' | 'unknown',
  manualLocked: Boolean,
  manualValue: String | null,
  lastWriteAt: Date | null,
  lastObservedAt: Date | null,
  lastActivityFingerprint: String | null,
  welcomeOverlay: {
    active: Boolean,
    originalValue: String | null,
    originalSource: 'manual' | 'media' | 'game' | 'default' | 'empty' | null,
    overlayValue: String | null,
    startedAt: Date | null,
    expiresAt: Date | null,
    originalFingerprint: String | null
  },
  failureCount: Number,
  nextRetryAt: Date | null
}
```

L’état runtime peut être mis en cache, mais le verrou manuel et la dernière valeur écrite par le bot doivent survivre à un redémarrage.

### 7.1 Persistance MongoDB

Les statuts de salons doivent être stockés en base MongoDB afin de survivre aux redémarrages du bot, conserver les verrous manuels et restaurer correctement un statut après un overlay de bienvenue.

La configuration persistante et l’état de synchronisation doivent être séparés :

- `voiceChannelStatusConfigs` : règles héritées de la guild, de la catégorie ou du salon ;
- `voiceChannelStatusStates` : dernière valeur observée, dernière valeur écrite par le bot et état courant du verrou.

Collection `voiceChannelStatusConfigs` :

```js
{
  guildId: String,
  scope: 'guild' | 'category' | 'channel',
  targetId: String,
  categoryId: String | null,
  channelId: String | null,
  enabled: Boolean,
  vocation: String,
  mode: 'automatic' | 'manual' | 'hybrid',
  mediaEnabled: Boolean,
  providers: [String],
  activityFamilies: [String],
  activityPriority: String,
  gameStatusMode: String,
  gameThreshold: Object,
  gameWeights: Object,
  aggregationMode: String,
  defaultStatus: String | null,
  clearWhenEmpty: Boolean,
  resetOnEmpty: Boolean,
  emptyResetDelaySeconds: Number,
  quietHours: Object,
  welcomeOverlay: Object,
  createdBy: String,
  updatedBy: String,
  createdAt: Date,
  updatedAt: Date
}
```

Contraintes :

- un seul document par couple `(guildId, scope, targetId)` ;
- `targetId` vaut la guild, la catégorie ou le salon selon `scope` ;
- les champs non renseignés au niveau inférieur sont résolus par héritage avant utilisation ;
- les modifications passent par les commandes de setup, jamais par une modification directe du statut courant.

Collection `voiceChannelStatusStates` :

```js
{
  guildId: String,
  channelId: String,
  effectiveConfigVersion: Number,
  currentDiscordValue: String | null,
  lastBotValue: String | null,
  lastBotWriteId: String | null,
  lastResolvedValue: String | null,
  source: String,
  manualLocked: Boolean,
  manualValue: String | null,
  manualObservedAt: Date | null,
  lastWriteAt: Date | null,
  lastObservedAt: Date | null,
  lastActivityFingerprint: String | null,
  welcomeOverlay: Object,
  failureCount: Number,
  nextRetryAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

Index unique recommandé pour l’état : `{ guildId: 1, channelId: 1 }`.

`lastBotWriteId` associe une observation à une écriture connue du bot. Si Discord ne fournit pas d’identifiant exploitable, la comparaison de valeur et de fenêtre temporelle sert de repli pour détecter une modification manuelle.

À chaque décision, le service charge la configuration effective, charge ou crée l’état, résout le statut, écrit Discord uniquement si nécessaire, puis persiste atomiquement la valeur, la source, le fingerprint et les timestamps. Les états de salons supprimés ou inaccessibles sont nettoyés périodiquement.

## 8. Architecture proposée

L’architecture doit être modulaire par défaut. Le cœur du système ne doit connaître ni la liste complète des providers, ni les règles particulières d’une famille d’activité. Toute nouvelle famille ou fonctionnalité doit pouvoir être ajoutée comme module indépendant.

```text
Discord events / reconciliation
              ↓
      VoiceStatusCoordinator
              ↓
       State + configuration
              ↓
      MediaActivityResolver
              ↓
       VoiceStatusResolver
              ↓
       VoiceStatusWriter
              ↓
        Discord voice status
```

### Composants

- `VoiceStatusCoordinator` : déclenche les synchronisations et déduplique les événements.
- `VoiceStatusConfigRepository` : charge la configuration effective.
- `MediaActivityResolver` : transforme les activités Discord en activités normalisées.
- `VoiceStatusResolver` : applique les priorités et produit une décision pure.
- `VoiceStatusStateRepository` : conserve le dernier état et le verrou manuel.
- `VoiceStatusWriter` : encapsule l’API Discord, les permissions, le rate limit et les retries.
- `WelcomeOverlayManager` : capture, affiche puis restaure les statuts temporaires sans écraser une modification concurrente.

### 8.1 Registre de modules

Un registre central permet d’activer et de désactiver des modules par guild, catégorie ou salon :

```js
activityRegistry.register({
  id: 'game',
  family: 'game',
  normalize(activity) {},
  isEligible(activity, context) {},
  resolve(activities, config) {},
  render(decision, config) {}
});
```

Chaque module doit être indépendant et respecter un contrat commun. Le moteur ne dépend que de ce contrat.

Modules initiaux recommandés :

- `media` : YouTube, Netflix, Twitch, Spotify ;
- `game` : activités de jeux Discord ;
- `welcome` : overlay temporaire à l’arrivée d’un membre ;
- `default` : statut configuré par défaut ;
- `quiet-hours` : suspension temporelle des automatismes.

Familles futures possibles :

- podcasts et livres audio ;
- musique ou écoute collaborative ;
- événements planifiés ;
- applications de travail ou de partage d’écran ;
- activités personnalisées fournies par une intégration externe.

### 8.2 Séparation des responsabilités

- Les **collecteurs** observent Discord et produisent des événements bruts.
- Les **adaptateurs** normalisent les activités d’un provider.
- Les **familles** déterminent si une activité est pertinente et comment elle est agrégée.
- Les **policies** appliquent les seuils, priorités, plages horaires et modes du salon.
- Les **renderers** transforment une décision en texte court.
- Le **writer** est le seul composant autorisé à écrire le statut Discord.
- Les **repositories** gèrent exclusivement la persistance MongoDB.

Un module ne doit pas accéder directement à Discord, à MongoDB ou à un autre module. Il reçoit un contexte et retourne une décision sérialisable.

### 8.3 Contrat de décision

Chaque famille doit retourner une décision de forme commune :

```js
{
  family: 'game',
  status: '🎮 Minecraft',
  priority: 50,
  confidence: 1,
  participants: ['userId'],
  fingerprint: 'game:minecraft:userId',
  expiresAt: Date | null,
  reason: 'threshold-reached'
}
```

Le resolver compare les décisions produites par les modules, applique la politique du salon et sélectionne au maximum une décision finale. Un module qui échoue ne doit pas empêcher les autres familles de fonctionner.

### 8.4 Ajout d’une nouvelle famille

Ajouter une famille doit nécessiter uniquement :

1. un module d’adaptation et de résolution ;
2. ses valeurs de configuration par défaut ;
3. son renderer ou ses templates ;
4. ses tests unitaires et d’intégration ;
5. son enregistrement dans le registre.

Le coordinateur, le modèle d’état, le writer Discord et les commandes générales ne doivent pas être modifiés pour chaque nouvelle famille.

Le resolver ne doit pas appeler Discord directement. Cela permet de tester toute la logique métier sans connexion externe.

## 9. Format interne d’une activité

```js
{
  userId,
  family: 'media' | 'game',
  provider: 'youtube',
  providerLabel: 'YouTube',
  title: 'Titre de la vidéo',
  details: null,
  startedAt: Date | null,
  observedAt: Date,
  fingerprint: String
}
```

Les providers doivent être implémentés comme des adaptateurs séparés. Le moteur ne dépend pas des détails spécifiques à PreMiD.

## 10. Algorithme de résolution

```js
function resolveVoiceStatus({ config, state, activities, now }) {
  if (!config.enabled) return { value: null, source: 'disabled', write: false };

  if (config.manualLock && state.manualLocked) {
    return { value: state.manualValue, source: 'manual', write: false };
  }

  const activityStatus = resolveActivityStatus(activities, config);
  if (activityStatus) return { ...activityStatus, write: true };

  if (config.defaultStatus && shouldUseDefaultStatus({ config, activities })) {
    return { value: config.defaultStatus, source: 'default', write: true };
  }

  const isStale = state.lastResolvedValue &&
    now - state.lastObservedAt < config.staleAfterSeconds * 1000;

  if (isStale && !config.clearWhenEmpty) {
    return { value: state.lastResolvedValue, source: 'empty-stale', write: false };
  }

  return { value: null, source: 'empty', write: true };
}
```

L’implémentation réelle devra gérer les cas `undefined`, les erreurs de permission, la comparaison normalisée des chaînes et le calcul de dominance par famille.

Exemple de décision :

```text
Salon : 6 membres
Activités : 3 × Valorant, 1 × Minecraft, 1 × Netflix, 1 sans activité

Valorant = 3 membres et 60 % des membres actifs → dominant
Résultat = 🎮 Valorant · 3
```

Contre-exemple par défaut :

```text
Salon : 5 membres
Activités : 1 × Valorant, 1 × Minecraft, 1 × Fortnite

Aucun jeu ne franchit minMembers=2 → résultat = aucun statut
```

Si la guild active explicitement `genericStatus: '🎮 Multigaming'`, le même cas peut produire ce statut. Cette option est réservée aux serveurs qui souhaitent signaler l’ambiance générale du salon même lorsqu’aucun jeu n’est dominant.

## 11. Déclencheurs

Une synchronisation est déclenchée par :

- arrivée, départ ou déplacement d’un membre dans un salon vocal ;
- changement de présence ou d’activité d’un membre présent ;
- modification de la configuration ;
- observation d’un changement de statut du salon ;
- timer de réconciliation périodique ;
- commande administrative `force`.

Un événement de join déclenche en plus le `WelcomeOverlayManager` si le salon est configuré pour cela. La rotation automatique est limitée aux valeurs jugées pertinentes par la configuration et ne doit pas créer artificiellement de statut générique.

Un événement de départ déclenche le reset automatique lorsque le salon ne contient plus aucun membre et que `resetOnEmpty` est activé.

Un événement de join déclenche en plus le `WelcomeOverlayManager` si le salon est configuré pour cela.

Les événements sont regroupés par `channelId` afin d’éviter plusieurs résolutions simultanées pour le même salon.

## 12. Commandes administratives

Commandes recommandées :

- `/voice-status configure` : configurer un salon ou une catégorie ;
- `/voice-status enable` / `disable` : activer ou désactiver ;
- `/voice-status lock` : verrouiller la valeur actuelle comme manuelle ;
- `/voice-status unlock` : rendre le salon à nouveau automatisable ;
- `/voice-status reset` : supprimer le verrou et recalculer ;
- `/voice-status force` : recalculer immédiatement ;
- `/voice-status debug` : afficher la décision, la source, les activités retenues et la dernière écriture ;
- `/voice-status event-override` : configurer le comportement des événements temporaires, avec deux modes :
  - `default` : utiliser les templates configurés et respecter les statuts manuels après l’expiration ;
  - `force` : afficher l’overlay même lorsqu’un statut manuel est présent, puis le restaurer s’il n’a pas changé.

La commande `event-override` est réservée aux administrateurs et ne doit pas modifier durablement le verrou manuel. Le mode `force` concerne uniquement les overlays événementiels ; il ne permet pas au moteur automatique de remplacer un statut manuel en dehors de cette fenêtre.

Toutes les commandes de modification nécessitent une permission de gestion du serveur ou une permission dédiée configurable.

## 13. Permissions et confidentialité

- Respecter les intents et permissions Discord nécessaires à la présence et aux membres.
- Ne pas stocker l’URL complète d’une vidéo ou d’un contenu privé si le titre suffit.
- Ne pas exposer dans le statut une information marquée comme privée par Discord.
- Prévoir une liste de providers désactivables par guild.
- Journaliser les erreurs et les décisions, mais éviter de journaliser les données média brutes.

## 14. Gestion des erreurs

- Permission absente : marquer le salon en erreur, journaliser une fois puis appliquer un backoff.
- Rate limit : respecter le délai Discord et ne pas retenter immédiatement.
- Provider inconnu : ignorer l’activité et continuer avec les autres providers.
- Activité malformée : ignorer l’entrée, sans faire échouer toute la synchronisation.
- État incohérent après redémarrage : effectuer une réconciliation avant toute écriture.

## 15. Critères d’acceptation

1. Un statut manuel verrouillé reste inchangé malgré plusieurs changements d’activité.
2. Un salon hybride vide avec une activité YouTube reçoit le statut calculé.
3. Une activité provenant d’un membre situé dans un autre salon est ignorée.
4. Un jeu joué par un seul membre ne devient pas le statut d’un salon multigaming.
5. Un jeu dominant selon `minMembers` et `minShare` devient le statut du salon.
6. Plusieurs jeux sous le seuil ne produisent aucun statut par défaut.
7. L’option `genericStatus` permet explicitement d’activer un statut générique multigaming.
8. La politique `media-first`, `game-first`, `dominant` ou `mixed` est respectée.
9. Deux événements identiques ne provoquent qu’une seule écriture Discord.
10. Une activité supprimée entraîne le statut par défaut ou la suppression selon la configuration.
11. Le redémarrage du bot ne supprime pas un verrou manuel.
12. Une activité d’un provider désactivé ne modifie pas le statut.
13. Les titres trop longs sont résumés sans dépasser la limite Discord.
14. Une erreur de permission ne déclenche pas une boucle de retries agressive.
15. La commande `reset` supprime le verrou et force une nouvelle résolution.
16. Un membre qui rejoint un salon configuré déclenche un message de bienvenue temporaire.
17. Après 10 à 15 secondes, le statut précédent est restauré, qu’il soit manuel ou automatique.
18. Une modification humaine pendant le message de bienvenue n’est jamais écrasée lors de la restauration.
19. Plusieurs arrivées rapprochées regroupent les noms jusqu’à trois personnes, puis utilisent une phrase générique.
20. Les titres média affichent prioritairement le titre du contenu plutôt que son auteur.
21. Une configuration de salon surcharge la configuration héritée de sa catégorie.
22. Un salon peut choisir son seuil de jeu et son mode `priority`, `none`, `generic` ou `summary`.
23. Les plages silencieuses désactivent les automatismes sans modifier les statuts manuels.
24. L’override `force` ne s’applique qu’à l’overlay événementiel et ne transforme pas le statut manuel en statut automatique.
25. Quand le salon devient vide, le statut, le verrou, l’activité et l’overlay sont réinitialisés après le délai configuré.
26. La configuration du salon reste présente après cette réinitialisation.
27. Un membre qui rejoint avant la fin du délai annule le reset.
28. Une famille d’activité inconnue ou en erreur n’empêche pas les autres familles de produire une décision.
29. Une nouvelle famille peut être ajoutée sans modifier le coordinateur ni le writer Discord.
30. Chaque module peut être activé ou désactivé indépendamment par guild, catégorie ou salon.
31. Un poids de jeu ne contourne jamais les seuils `minMembers` et `minShare`.
32. À seuils atteints, le jeu ayant le meilleur score pondéré est sélectionné en mode prioritaire.
33. Les poids peuvent être hérités ou surchargés au niveau de la guild, de la catégorie et du salon.

## 16. Plan d’implémentation

### Phase 1 — socle

- définir les modèles de configuration et d’état ;
- implémenter le resolver pur et ses tests ;
- implémenter l’écriture idempotente avec cache et rate limit ;
- ajouter `debug`, `lock`, `unlock` et `reset`.

### Phase 2 — activités

- normaliser les activités Discord ;
- ajouter YouTube, Netflix, Twitch et Spotify ;
- brancher les événements de présence et de voice state ;
- ajouter la réconciliation périodique.

### Phase 3 — qualité d’usage

- agrégation avancée ;
- configuration par catégorie ;
- métriques et logs structurés ;
- mode simulation et aperçu avant activation.

## 17. Décisions prises pour le serveur d’amis

- Setup disponible par catégorie et par salon, avec priorité au salon.
- Seuil configurable par salon pour les activités de jeu.
- Mode de jeu configurable : jeu prioritaire, aucun statut, texte générique ou résumé.
- Les médias affichent en priorité le titre du contenu.
- Les statuts non utiles restent absents plutôt que d’afficher un texte générique.
- Les statuts obsolètes peuvent disparaître rapidement ; une rotation de 30 secondes est acceptable.
- Les phrases de bienvenue sont fournies par l’administrateur via une liste de templates.
- Les arrivées sont regroupées jusqu’à trois noms, puis basculent sur un message générique.
- Les overrides manuels restent prioritaires, à l’exception explicite de l’overlay de bienvenue.
- Les plages horaires silencieuses sont optionnelles.
- Un override événementiel peut fonctionner en mode normal ou forcé, mais le mode forcé reste limité à l’événement.

## 18. Règles normatives consolidées

Cette section fait foi en cas de conflit avec une formulation plus ancienne de la spec.

### 18.1 Matrice de priorité

La décision finale suit cet ordre :

```text
1. reset-on-empty
2. overlay événementiel forcé, uniquement pendant sa durée
3. overlay de bienvenue, uniquement pendant sa durée
4. statut manuel verrouillé
5. décision automatique issue des policies
6. statut par défaut explicitement configuré
7. absence de statut
```

Les niveaux 2 et 3 sont les seules opérations autorisées à remplacer temporairement un statut manuel. Ils doivent sauvegarder sa valeur et ne peuvent pas le remplacer durablement. Un override forcé ne donne jamais au moteur automatique le droit de modifier un statut manuel hors de l’événement concerné.

### 18.2 Deux types de nettoyage

Les options suivantes sont distinctes :

- `clearWhenNoActivity` : des membres sont présents, mais aucune activité utile n’est détectée ;
- `resetOnEmpty` : aucun membre n’est présent ; le statut et l’état runtime sont nettoyés.

`clearWhenEmpty` est déprécié et doit être traité comme un alias de `clearWhenNoActivity` pendant la migration. Il ne doit plus être utilisé dans le nouveau code.

### 18.3 Écritures sérialisées

Chaque salon possède un verrou d’écriture logique. Une seule opération `sync`, `rotation`, `welcome`, `eventOverride` ou `reset` peut écrire à la fois.

```js
{
  operationId: String,
  operationType: String,
  startedAt: Date,
  expiresAt: Date | null
}
```

Une opération qui perd le verrou ne peut plus écrire ni restaurer une ancienne valeur. Toute restauration vérifie d’abord que la valeur Discord observée correspond encore à la valeur de l’overlay. Sinon, la modification humaine ou externe est conservée.

### 18.4 Reset de session vide

Le départ du dernier membre crée un `emptySessionId` et programme le reset après `emptyResetDelaySeconds`. Une nouvelle arrivée invalide ce `emptySessionId` et annule le reset.

Le reset réussi :

- supprime le statut Discord si possible ;
- supprime le lock manuel et sa valeur ;
- annule tout overlay et toute rotation ;
- supprime les activités et fingerprints ;
- conserve uniquement la configuration persistante.

Si la suppression Discord échoue, l’état passe à `resetPending` avec `syncStatus: 'error'` et sera réessayé lors de la prochaine réconciliation. La base ne doit pas prétendre que le reset est terminé tant que Discord n’a pas confirmé l’opération.

### 18.5 Pondération et résumé des jeux

Un jeu doit d’abord atteindre `minMembers` et `minShare`. Ensuite seulement, le score pondéré est calculé :

```text
score = participants × gameWeight
```

Les modes sont définis ainsi :

- `priority` : seul le jeu au meilleur score est affiché ;
- `none` : aucun jeu n’est affiché ;
- `generic` : le texte générique est affiché si au moins un jeu atteint le seuil ;
- `summary` : tous les jeux atteignant le seuil sont affichés, triés par score décroissant, avec une limite `maxSummaryItems`.

Les poids ne servent donc jamais à faire apparaître un jeu sous le seuil. `gameWeights` doit être persisté dans la configuration MongoDB et fusionné selon les règles d’héritage ci-dessous.

### 18.6 Séparation des policies

Les responsabilités sont séparées ainsi :

```text
ActivityProvider   → collecte et normalisation
ActivityFamily     → éligibilité et agrégation
SelectionPolicy    → seuils, poids et priorité
RenderingPolicy    → format du texte final
LifecycleHook      → join, leave, reset, bienvenue
Persistence        → configuration et état
DiscordWriter      → écriture idempotente et rate limit
```

`activityPriority`, `gameStatusMode` et `aggregationMode` ne doivent pas décider simultanément de la même chose : les deux premiers appartiennent à la sélection, le dernier au rendu.

### 18.7 Rotation

La rotation est facultative et ne s’applique qu’à plusieurs décisions pertinentes déjà éligibles. Elle :

- ne remplace jamais un statut manuel ;
- est suspendue pendant un overlay ;
- est annulée lorsque le salon devient vide ;
- respecte `minUpdateIntervalSeconds` ;
- ne crée aucun statut générique ;
- utilise `statusRotationSeconds` uniquement comme intervalle, pas comme mécanisme de sélection.

### 18.8 Héritage de configuration

La résolution suit `guild → catégorie → salon`.

- scalaires : le niveau inférieur surcharge le niveau supérieur ;
- objets : fusion profonde ;
- tableaux : remplacement complet ;
- `null` : suppression explicite de la valeur héritée ;
- champ absent : héritage inchangé.

Cela vaut notamment pour `providers`, `activityFamilies`, `gameWeights`, `welcomeOverlay` et `quietHours`.

### 18.9 Profils de vocation

Les profils sont des préréglages uniquement :

- `gaming` : jeux activés, seuil configurable, mode générique désactivé ;
- `cinema` : médias et titres prioritaires, rotation limitée ;
- `music` : titres musicaux prioritaires ;
- `chill` : médias activés, faible fréquence de changement ;
- `work` : aucun texte générique, seuils élevés, bienvenue optionnelle ;
- `general` : règles équilibrées et peu intrusives ;
- `custom` : aucune valeur implicite au-delà des valeurs système.

Une valeur explicitement configurée au niveau catégorie ou salon est toujours prioritaire sur le profil.

### 18.10 Détection manuelle et persistance

Chaque écriture du bot reçoit un `operationId` et persiste `lastBotValue`, `lastBotWriteId` et `lastBotWriteAt`. Une valeur observée différente est considérée comme externe uniquement si elle ne correspond pas à une opération active ou récemment confirmée.

Le modèle d’état doit également contenir :

```js
{
  emptySessionId: String | null,
  syncStatus: 'idle' | 'pending' | 'resetPending' | 'error',
  writeLock: Object | null,
  lastBotWriteAt: Date | null
}
```

### 18.11 Contrat d’erreur des modules

Chaque module doit retourner une décision ou une erreur structurée :

```js
{
  ok: false,
  error: {
    code: 'PROVIDER_UNAVAILABLE',
    retryable: true,
    message: '...'
  }
}
```

Une erreur d’un provider ou d’une famille est isolée. Elle ne bloque ni les autres familles, ni la persistance, ni le reset du salon.

### 18.12 Overlay de bienvenue

Les arrivées sont regroupées pendant la fenêtre d’overlay :

- de 1 à 3 personnes : utiliser les noms via `{user}` ou `{users}` ;
- au-delà de 3 personnes : utiliser une phrase générique ou `{count}` ;
- un nouveau join prolonge ou remplace l’overlay selon la configuration, mais ne crée jamais plusieurs écritures concurrentes.

## 19. Décisions à valider

- Le statut manuel doit-il être verrouillé indéfiniment jusqu’à `/unlock`, ou expirer après une durée configurable ?
- En cas de plusieurs activités, préfère-t-on afficher les titres, uniquement les providers ou seulement un compteur ?
- Le statut doit-il être supprimé quand le salon devient vide, ou conserver le dernier statut pendant un délai ?
- Pour les jeux, préfère-t-on le seuil recommandé `2 membres + 50 % des membres actifs`, ou un seuil propre à chaque salon ?
- En cas de média et de jeu simultanés, veut-on privilégier le média, le jeu dominant ou un résumé mixte ?
- Le message de bienvenue doit-il être activable par salon, par catégorie ou uniquement globalement ?
- Pour plusieurs arrivées rapprochées, préfère-t-on afficher le dernier nom, regrouper les noms ou afficher seulement `👋 Bienvenue !` ?
- Veut-on gérer plusieurs listes de phrases selon le salon, la catégorie ou la guild ?
- Quels rôles peuvent configurer et forcer les statuts ?
- Faut-il activer les providers par défaut, ou demander une activation explicite par guild ?

