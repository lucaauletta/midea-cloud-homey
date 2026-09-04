# Midea Cloud (NetHome Plus) per Homey

App Homey (SDK 3, TypeScript) che controlla i condizionatori Midea / Comfee / Carrier / Senville
e altri brand compatibili con l'app **NetHome Plus**, passando dal **cloud Midea** invece che dalla LAN.

## Perché il cloud

Dal 28 agosto 2026 Midea ha chiuso l'endpoint `/v1/iot/secure/getToken` del cloud NetHome Plus
(risponde `errorCode 9999`). Senza token/key non è più possibile fare il pairing locale delle unità
con protocollo v3, ed è questo che blocca l'app community "Midea" (nl.intyme.midea) e le
integrazioni Home Assistant. Gli altri endpoint del cloud NetHome Plus funzionano ancora
(verificato il 4 settembre 2026):

| Endpoint | Stato |
|---|---|
| `/v1/user/login/id/get`, `/v1/user/login` | OK |
| `/v1/appliance/user/list/get` | OK |
| `/v1/appliance/transparent/send` (comandi e stato) | OK |
| `/v1/iot/secure/getToken` | chiuso (9999) |

Questa app usa `transparent/send`, cioè lo stesso canale che l'app NetHome Plus usa quando il
telefono non è sulla rete di casa. Il cloud MSmartHome (`mp-prod.appsmb.com`) invece va in timeout
al login e non viene usato.

## Struttura

- `lib/NetHomePlusCloud.ts` – login, lista apparecchi, invio "trasparente" con cifratura AES della sessione
- `lib/MideaAC.ts` – frame `0xAA` (query stato `0x41`, set `0x40`), parsing risposta `0xC0`, pacchetto cloud `5A5A`
- `drivers/ac/` – driver Homey: pairing con login NetHome Plus, polling, capability e Flow card
- `scripts/probe.cjs` – test end-to-end da terminale, senza Homey

## Prerequisiti

- Node.js 24 (già presente)
- Docker Desktop o OrbStack: la CLI Homey lo richiede per `homey app run` / `homey app install` su Homey Pro mini
- Un account NetHome Plus con i condizionatori già associati

## 1. Verifica dal terminale (prima di toccare Homey)

```bash
npm install
npm run build
MIDEA_USER='tua@email' MIDEA_PASS='password' node scripts/probe.cjs
```

Il probe stampa la lista apparecchi e legge lo stato del primo condizionatore. Per provare un
comando (spegne/accende la prima unità):

```bash
MIDEA_USER='tua@email' MIDEA_PASS='password' node scripts/probe.cjs <applianceId> --set-power off
```

Le credenziali vanno passate come variabili d'ambiente, non sono salvate da nessuna parte.

## 2. Installazione su Homey

```bash
npx homey login
npx homey app run
```

`homey app run` compila, carica l'app sull'Homey selezionato e mostra i log in tempo reale.
Per lasciarla installata dopo la chiusura del terminale usa `npx homey app install`.

Poi in Homey: *Aggiungi dispositivo → Midea Cloud → Condizionatore (cloud)*, inserisci le credenziali
NetHome Plus e scegli le unità.

## Funzioni

Stesse funzioni dell'app community "Midea" per Homey (nl.intyme.midea), ma tutte via cloud:

| Funzione | Capability | Flow card |
|---|---|---|
| Accensione/spegnimento | `onoff` | standard Homey |
| Modalità off/auto/cool/heat/dry/fan | `midea_mode` | cambiata in…, è…, imposta… |
| Temperatura target 16–30 °C (passo 0,5) | `target_temperature` | standard Homey |
| Temperatura interna ed esterna | `measure_temperature`, `measure_temperature.outdoor` | standard Homey |
| Velocità ventola auto/silenziosa/bassa/media/alta/massima | `midea_fan_speed` | cambiata in…, è…, imposta… |
| Oscillazione ferma/verticale/orizzontale/entrambe | `midea_swing_mode` | cambiata in…, è…, imposta… |
| Turbo | `midea_turbo` | attivata, disattivata, è attiva, attiva, disattiva |
| ECO (forza modalità cool) | `midea_eco` | attivata, disattivata, è attiva, attiva, disattiva |
| Antigelo 8 °C (forza modalità heat) | `midea_freeze_protection` | attivata, disattivata, è attiva, attiva, disattiva |

I trigger scattano anche quando lo stato cambia dal telecomando o dall'app NetHome Plus,
perché il polling rileva la differenza.

## Impostazioni dispositivo

- intervallo di polling (default 30 s, minimo 10 s): ogni lettura è una chiamata al cloud Midea
- numero di errori consecutivi prima di segnare il dispositivo "non disponibile"
- livello di log (errori / informazioni / debug con richieste cloud e frame esadecimali)

## Riparazione

Se cambi la password NetHome Plus usa *Ripara* sul dispositivo: chiede di nuovo le credenziali
e riconnette senza dover rimuovere e riaggiungere l'unità.

## Note

- Le credenziali NetHome Plus vengono salvate nello store del dispositivo su Homey (come fa l'app community esistente).
- Se Midea chiude anche `transparent/send`, l'app smette di funzionare: non esiste alternativa locale senza token/key.
- Riferimenti protocollo: [midea-beautiful-air](https://github.com/nbogojevic/midea-beautiful-air),
  [midea-msmart](https://github.com/mill1000/midea-msmart),
  [midea-msmarthome-ac-euosk105](https://github.com/mteutelink/midea-msmarthome-ac-euosk105).
