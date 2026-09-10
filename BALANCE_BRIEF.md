# Wheat2Wealth — Référentiel d'équilibrage (à lire avant tout playtest)

Ce document existe parce qu'un précédent playtest automatisé (Playwright) a tiré des
conclusions sur l'équilibrage sans avoir lu les vraies formules du code, et a inventé
un chiffre qui n'existe pas ("×4 par génération"). **Avant de formuler la moindre
critique d'équilibrage, va vérifier la formule exacte dans `lib/gameLogic.js` et
cite-la.** Ne déduis jamais un taux de scaling depuis le ressenti en jeu seul.

## 1. Les deux courbes de coût — ne pas les confondre

Il y a DEUX multiplicateurs différents dans ce jeu, qui s'appliquent à des choses
différentes :

- **`genCostMult` = 1,25 ^ (génération - 1)** → +25% sur les coûts de base à chaque
  reset de génération (parcelles, technologies). C'est doux, volontairement.
- **Courbe par niveau d'une techno** = `baseCost × 1,6 ^ niveau` → ÇA, c'est la
  courbe raide (niveau 10 ≈ ×87 le prix de base). Elle s'applique **au sein d'une
  même génération**, pas entre générations.

Un test qui dit "le coût explose après la gen 3" doit préciser : est-ce parce que la
génération monte, ou parce que le joueur monte les niveaux d'une techno ? Ce sont deux
leviers de design différents, avec des intentions différentes.

## 2. Philosophie de design (pourquoi certains seuils existent)

- **Le jeu manuel doit toujours être au moins aussi rentable que l'AFK complet.**
  Le courtier automatique a une taxe qui ne descend jamais sous 3%, les machines ont
  une pénalité qui ne descend jamais sous 0% mais seulement au niveau max — vendre à
  la main reste toujours la meilleure option pour un joueur optimisateur. Une
  recommandation qui rendrait l'automatisation "gratuite" irait à l'encontre de cet
  objectif assumé.
- **Les "Sacs multi-parcelles" (récolte/semis de 2 à 4 parcelles par action) sont
  volontairement débloqués tard (gen 4 pour le niveau 2, gen 6 pour les niveaux 3-4).**
  Ce n'est pas un oubli : c'est une réponse à un problème précis qui n'apparaît que
  sur les grandes exploitations (jusqu'à 16×16 parcelles), où réduire l'intervalle des
  ouvriers sous 2 secondes ou multiplier les employés deviendrait illisible à l'écran.
  Un test qui n'atteint jamais une grande exploitation n'a pas le contexte pour juger
  ce seuil "trop tardif".
- **La revente d'exploitation (prestige) est un vrai reset** : parcelles et
  technologies retombent à zéro, mais le joueur gagne un bonus permanent de +10%
  d'efficacité par génération (rendement, vitesse, capacité de silo) et peut viser une
  exploitation plus grande à chaque palier. C'est "reconstruire mais plus fort", pas
  une punition.
- **Le "temps d'attente" en tout début de partie est en partie volontaire.** Une
  bonne partie du travail d'UI (barres de progression, popups de gain flottants,
  flashs visuels) a été faite spécifiquement pour rendre l'attente et l'automatisation
  gratifiantes plutôt qu'ennuyeuses — ce n'est pas juste un défaut à corriger à la
  racine, sauf si l'attente initiale (avant le premier ouvrier) est jugée réellement
  excessive.

## 3. Formules de référence (à vérifier dans le code, pas à deviner)

| Système | Formule | Fichier |
|---|---|---|
| Coût d'une parcelle | `20 + (parcelles possédées - 2) × 15`, × `genCostMult` | `plotCost()` |
| Temps de pousse | `max(3, (12 - niveau_irrigation × 1,5) / genPowerMult)` | `growTimeSeconds()` |
| Rendement/récolte | `(3 + niveau_graines × 2) × genPowerMult` | `yieldAmount()` |
| Capacité silo | `(parcelles_totales × 1,5 + niveau_silo × 20) × genPowerMult` | `siloCap()` |
| Coût d'une techno (niveau N) | `baseCost × 1,6^N × genCostMult` | `upgradeCost()` |
| Bonus permanent par génération | `genPowerMult = 1,10 ^ (génération - 1)` | `genPowerMult()` |
| Inflation des coûts par génération | `genCostMult = 1,25 ^ (génération - 1)` | `genCostMult()` |
| Intervalle ouvrier/semeur | `max(2, 12 - (niveau - 1) × 2,5)` secondes | `ouvrierInterval()` / `semeurInterval()` |
| Coût d'un employé supplémentaire | `max(50, 120 × revenu_moyen_p/s) × 2^(N-2)` | `workerSlotCost()` |
| Coût des sacs multi-parcelles | `200 × employés^1,5 × niveau_visé^2,2 × genCostMult` | `bagUpgradeCost()` |
| Déblocage sac niveau 2 / 3-4 | Génération ≥ 4 / Génération ≥ 6 | `BAG_MIN_GEN_LEVEL2`, `BAG_MIN_GEN_LEVEL3PLUS` |
| Bonus de remplissage silo (vente) | Interpolation sur points (50%→2%, 75%→5%, 90%→10%, 98%→20%) | `fillBonusPct()` |
| Tampon silo avant perte réelle | 110% de la capacité nominale, dès génération 3 | `SILO_BUFFER_MULT` |
| Revente d'exploitation | 40% de (parcelles + technos investies) + blé en stock | `computeResaleValue()` |

## 4. Comment mener un test utile

1. **Distingue explicitement la portée de ton test** dans ton rapport : "onboarding
   des 5 premières minutes" ≠ "santé de l'économie en milieu de partie" ≠
   "équilibrage post-prestige". Ce sont trois analyses différentes, ne les mélange pas
   dans une seule conclusion.
2. **Ne teste pas uniquement en temps réel.** Une session Playwright de 10-15 minutes
   ne peut pas juger la génération 4+ de façon crédible. Si tu veux évaluer le
   milieu/fin de partie, demande d'abord si un moyen d'avancer plus vite existe
   (sauvegarde de test, compte de démo pré-rempli, etc.) plutôt que de conclure "ça
   arrive trop tard" depuis une partie qui n'y est jamais arrivée.
3. **Avant toute affirmation chiffrée sur une formule, cite la ligne de code exacte**
   (fichier + fonction) qui la justifie. Si tu ne peux pas la retrouver, dis "je n'ai
   pas vérifié cette formule" plutôt que d'avancer un chiffre.
4. **Sépare "friction non voulue" (bug, blocage, incohérence) de "friction voulue"**
   (attente délibérée, seuil de génération assumé). Ne recommande de changer que ce
   qui relève clairement de la première catégorie, ou signale explicitement quand tu
   proposes de changer un choix de design assumé.
