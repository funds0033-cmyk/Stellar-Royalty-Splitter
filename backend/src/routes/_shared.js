import { retryBuildTx, networkPassphrase } from "../stellar.js";
import { recordTransaction, addAuditLog } from "../database/index.js";
import { validateXdrStructure } from "../xdr-validation.js";

/**
 * Shared pattern for transaction-building routes:
 * 1. Record transaction in database
 * 2. Build transaction XDR (with correlation ID threaded through RPC calls)
 * 3. Validate XDR structure before returning
 * 4. Log audit event
 * 5. Return XDR and transaction ID
 *
 * #396: Accepts an optional `correlationId` so every Stellar RPC call made
 * during this request shares the same trace context in logs and metrics.
 */
export async function buildAndRecordTransaction({
  contractId,
  walletAddress,
  transactionType,
  contractMethod,
  scvlArgs,
  auditAction,
  auditMetadata,
  transactionMetadata = {},
  correlationId,
}) {
  const method = contractMethod ?? transactionType;
  const transactionId = recordTransaction(
    contractId,
    transactionType,
    walletAddress,
    transactionMetadata
  );

  const txXdr = await retryBuildTx(
    walletAddress,
    contractId,
    method,
    scvlArgs,
    correlationId,
  );

  const validation = validateXdrStructure(txXdr, networkPassphrase);
  if (!validation.valid) {
    throw {
      status: 500,
      code: "xdr_validation_error",
      message: `Invalid transaction XDR: ${validation.errors.join("; ")}`,
    };
  }

  // Log the audit event
  addAuditLog(contractId, auditAction, walletAddress, {
    transactionId,
    ...auditMetadata,
  });

  return { xdr: txXdr, transactionId };
}
