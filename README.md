# Claude Auto Continue

> **Leggi prima: Claude Code ha già una funzione integrata.**
> Analizzando la CLI `@anthropic-ai/claude-code` 2.1.288 (binario `linux-x64`, stringhe e impostazioni) ho trovato:
> - l'impostazione `autoContinueAtUsageLimit` (con `autoContinueAtUsageLimitToggleable`);
> - al limite compare "Usage limit reached · continuing automatically ... · esc to cancel": la CLI attende il reset e riparte da sola, inviando "You can continue now. Continue the task you were working on when the usage limit was reached; do not repeat work that is already complete.";
> - `Esc` annulla l'attesa, `/rate-limit-options` la riattiva; se il reset è oltre 24 ore l'attesa automatica non parte e va richiesta con `/rate-limit-options`;
> - messaggi correlati: "Usage limit has reset · press enter to continue", "Usage limit reset. Re-running...".
>
> **Consiglio:** prova prima ad attivare `autoContinueAtUsageLimit` (`/config` o `settings.json`). Questa estensione serve solo se la funzione integrata non copre il tuo caso (es. pannello grafico di VS Code).
>
> **Limiti dell'analisi:** non ho trovato la stringa esatta `5-hour limit reached ∙ resets 3pm` nel binario, quindi il formato cercato dal parser è un'ipotesi e può cambiare tra versioni. Il codice del pannello VS Code (`.vsix`) non è stato analizzato (marketplace non raggiungibile dall'ambiente), quindi non so se il pannello usi la stessa funzione.

Estensione VS Code che, quando Claude Code raggiunge il **limite delle 5 ore**, legge l'orario di reset e invia automaticamente **"continua"** appena il limite viene ripristinato.

## Come funziona
1. Controlla ogni 5 s i transcript di Claude Code (`~/.claude/projects/**/*.jsonl`).
2. Se trova un messaggio tipo `5-hour limit reached ∙ resets 3pm (Europe/Rome)` calcola l'istante di reset.
3. Mostra in status bar `Continua alle HH:MM` e, al reset (+ `delaySeconds`, default 60 s), invia il messaggio.

## Modalità di invio
L'estensione ricorda **la sessione che ha colpito il limite** (ID dal transcript) e la usa per l'invio.
- **`cli`** (la più affidabile): esegue `claude --resume <id-sessione> -p "continua"` nella cartella del progetto, quindi continua esattamente quella conversazione senza toccare la UI. La risposta si vede riaprendo/ricaricando la sessione nel pannello. Imposta `claudeAutoContinue.claudePath` se `claude` non è nel PATH.
- **`chat`**: mette a fuoco la chat **già aperta** (anche nella barra laterale destra), poi scrive "continua" e preme Invio a livello di sistema (`xdotool` su Linux, `osascript` su macOS, PowerShell su Windows; personalizzabile con `submitCommand`). Non apre chat nuove. Se hai attivato `claudeCode.useCtrlEnterToSend`, invia con Ctrl+Invio. Dalla documentazione ufficiale: il comando *Claude Code: Focus Input* (Ctrl+Esc) è un toggle editor/Claude, quindi si usa prima *Open in Side Bar*; l'URI `vscode://anthropic.claude-code/open` apre un tab (con `session=<id>` solo se la sessione appartiene al workspace aperto, altrimenti parte una chat nuova) e il prompt non viene mai inviato da solo. Il comando di focus viene rilevato automaticamente; se non parte, esegui *Claude Auto Continue: Elenca comandi di Claude Code* e metti quello giusto in `focusCommand`. Ripiego: `workbench.action.focusAuxiliaryBar`. **Non verificato** sul pannello reale.
- **`terminal`**: per la CLI `claude` nel terminale integrato: `sendText("continua")` + Invio.

## Comandi
Auto-continua attiva/disattiva · Programma invio a un orario · Invia ora · Annulla.

## Installazione
```
npm i -g @vscode/vsce
cd vscode-claude-autocontinue && vsce package
code --install-extension claude-auto-continue-0.1.0.vsix
```
(oppure F5 da VS Code con la cartella aperta per provarla).
