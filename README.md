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
- **`terminal`** (consigliata se usi la CLI `claude` nel terminale integrato): `sendText("continua")` + Invio, affidabile.
- **`chat`** (pannello grafico): l'estensione non ha un'API pubblica per inviare messaggi al pannello, quindi precompila il prompt tramite l'URI handler `vscode://anthropic.claude-code/open?prompt=...` e, se impostato, esegue `submitCommand` per premere Invio a livello di OS:
  - Linux: `xdotool key Return`
  - macOS: `osascript -e 'tell application "System Events" to key code 36'`
  - Windows: `powershell -c "(New-Object -ComObject WScript.Shell).SendKeys('{ENTER}')"`

> Non ho potuto testare l'integrazione con il pannello Claude Code in questo ambiente (nessun VS Code/Claude Code): verifica la modalità `chat` sulla tua macchina. Il parser dell'orario è coperto da `node test.js`.

## Comandi
Auto-continua attiva/disattiva · Programma invio a un orario · Invia ora · Annulla.

## Installazione
```
npm i -g @vscode/vsce
cd vscode-claude-autocontinue && vsce package
code --install-extension claude-auto-continue-0.1.0.vsix
```
(oppure F5 da VS Code con la cartella aperta per provarla).
