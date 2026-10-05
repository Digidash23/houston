import { FormDialog } from "@houston-ai/core";
import { useTranslation } from "react-i18next";
import {
  ApiKeyNameField,
  ApiKeyReveal,
  useApiKeyCreateFlow,
} from "./api-key-create-flow";

interface ApiKeyCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Mint an API key, then reveal its secret exactly once.
 *
 * ONE `FormDialog` wearing two faces: a name form, then the show-once view.
 * The swap is what the recipe's `false` outcome is for — the mint SUCCEEDED,
 * so a dialog that closed on resolve would carry the only copy of the secret
 * off screen with it. The flow itself (`api-key-create-flow.tsx`) is shared
 * with the AI Manager's chat card; every close clears it, so a revealed key
 * cannot linger behind the dialog.
 */
export function ApiKeyCreateDialog({
  open,
  onOpenChange,
}: ApiKeyCreateDialogProps) {
  const { t } = useTranslation("settings");
  const flow = useApiKeyCreateFlow();
  const { revealed } = flow;

  function close() {
    flow.clear();
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        revealed ? t("apiKeys.create.revealTitle") : t("apiKeys.create.title")
      }
      description={
        revealed
          ? t("apiKeys.create.revealSubtitle", { name: revealed.name })
          : t("apiKeys.create.subtitle")
      }
      primary={
        revealed
          ? { label: t("apiKeys.create.done") }
          : {
              label: t("apiKeys.create.submit"),
              // Either outcome keeps the dialog: the secret has to be read
              // once, and a refused mint keeps the typed name beside its inline
              // notice. The recipe's re-entry guard is what stops a second
              // Enter minting a second key and losing the first secret.
              onClick: async () => {
                await flow.submit();
                return false;
              },
              disabled: flow.name.trim().length === 0,
            }
      }
      // Nothing left to cancel once the key exists: the secret is the only
      // thing on screen and reading it is the one way out.
      secondary={revealed ? null : undefined}
      labels={{
        cancel: t("apiKeys.create.cancel"),
        close: t("apiKeys.dialogClose"),
      }}
    >
      {revealed ? (
        <ApiKeyReveal created={revealed} />
      ) : (
        <ApiKeyNameField flow={flow} autoFocus />
      )}
    </FormDialog>
  );
}
