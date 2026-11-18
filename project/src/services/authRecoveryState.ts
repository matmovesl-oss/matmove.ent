let recoveryUserId: string | null = null;
let recoveryMarkedAt = 0;

export function observePasswordRecoveryEvent(event: string, userId?: string | null) {
  if (event === 'PASSWORD_RECOVERY' && userId) {
    recoveryUserId = userId;
    recoveryMarkedAt = Date.now();
    return;
  }
  if (event === 'SIGNED_OUT' || (userId && recoveryUserId && userId !== recoveryUserId)) {
    recoveryUserId = null;
    recoveryMarkedAt = 0;
  }
}

export function hasVerifiedPasswordRecovery(userId: string | null | undefined): boolean {
  return !!userId && recoveryUserId === userId && Date.now() - recoveryMarkedAt <= 15 * 60 * 1000;
}

export function clearVerifiedPasswordRecovery(userId?: string | null) {
  if (!userId || recoveryUserId === userId) {
    recoveryUserId = null;
    recoveryMarkedAt = 0;
  }
}
