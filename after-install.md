# Puritanical for Hermes installed

Enable it if you did not install with `--enable`:

```bash
hermes plugins enable puritanical
```

Restart Hermes or the gateway after enabling.

In shared gateways, restrict `/puritanical` to trusted users with Hermes slash-command access controls; runtime mode is process-local.

Commands:

- `/puritanical [lite|full|ultra|off]`
- `/puritanical-review [target]`
- `/puritanical-audit [target]`
- `/puritanical-debt`
- `/puritanical-help`

Bundled skills are available as `puritanical:puritanical`, `puritanical:puritanical-review`, `puritanical:puritanical-audit`, `puritanical:puritanical-debt`, and `puritanical:puritanical-help`.
