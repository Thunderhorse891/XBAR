const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => (typeof value === 'string' ? value.slice(0, 300) : null);
const PAGE_SIZE = 25;

function complete(result) {
  return (
    !result.error && Array.isArray(result.data) && result.count === result.data.length && result.data.length <= 1000
  );
}

// Called only after the shared, server-verified platform-owner check. This is
// an account directory, not a grant to enter customer ranches or modify plans.
export async function readOwnerAccounts(admin, page) {
  const result = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
  const users = result.data?.users;
  if (
    result.error ||
    !Array.isArray(users) ||
    users.length > PAGE_SIZE ||
    users.some((user) => !user || !UUID.test(user.id)) ||
    new Set(users.map((user) => user.id)).size !== users.length
  ) {
    throw new Error('Account directory incomplete');
  }
  const userIds = users.map((user) => user.id);
  let spaces = [],
    profiles = [];
  if (userIds.length) {
    const ranches = await admin
      .from('workspaces')
      .select('id, owner_user_id, name, business_name', { count: 'exact' })
      .in('owner_user_id', userIds)
      .limit(1001);
    if (
      !complete(ranches) ||
      ranches.data.some((space) => !space.id || !userIds.includes(space.owner_user_id)) ||
      new Set(ranches.data.map((space) => space.id)).size !== ranches.data.length
    )
      throw new Error('Ranch directory incomplete');
    spaces = ranches.data;
    if (spaces.length) {
      const ids = spaces.map((space) => space.id);
      const plans = await admin
        .from('workspace_subscription_profiles')
        .select('workspace_id, tier, billing_state, updated_at', { count: 'exact' })
        .in('workspace_id', ids)
        .limit(1001);
      if (
        !complete(plans) ||
        plans.data.some((plan) => !ids.includes(plan.workspace_id)) ||
        new Set(plans.data.map((plan) => plan.workspace_id)).size !== plans.data.length
      )
        throw new Error('Plan directory incomplete');
      profiles = plans.data;
    }
  }
  return {
    page,
    // The installed auth SDK truncates multi-digit Link page numbers. Advance
    // numerically instead; a full final page may lead to an explicitly empty
    // page, but no account is silently omitted and no global total is invented.
    nextPage: users.length === PAGE_SIZE ? page + 1 : null,
    accounts: users.map((user) => ({
      id: user.id,
      email: text(user.email),
      emailConfirmed: Boolean(user.email_confirmed_at),
      createdAt: text(user.created_at),
      lastSignInAt: text(user.last_sign_in_at),
      ownedWorkspaces: spaces
        .filter((space) => space.owner_user_id === user.id)
        .map((space) => {
          const plan = profiles.find((profile) => profile.workspace_id === space.id);
          return {
            id: space.id,
            name: text(space.business_name || space.name),
            tier: text(plan?.tier),
            billingState: text(plan?.billing_state),
            syncedAt: text(plan?.updated_at),
          };
        }),
    })),
  };
}
