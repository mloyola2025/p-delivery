import { ensureCloudSchema, getCloudDb } from "../lib/cloudDb";
import type { AdminSession } from "./adminAuth";
import type { CourierUser } from "./courierAuth";

export type Operator =
  | { type: "admin"; user: AdminSession }
  | { type: "courier"; user: CourierUser };

export async function operatorCanAccessOrder(
  operator: Operator,
  orderId: string,
) {
  await ensureCloudSchema();
  const sql = getCloudDb();
  if (operator.type === "courier") {
    const rows = await sql<{ allowed: boolean }[]>`
      select exists(
        select 1 from orders
        where id = ${orderId}
          and data->>'assignedCourierId' = ${operator.user.id}
      ) as allowed
    `;
    return Boolean(rows[0]?.allowed);
  }
  if (operator.user.role === "superadmin") {
    const rows = await sql<{ allowed: boolean }[]>`
      select exists(select 1 from orders where id = ${orderId}) as allowed
    `;
    return Boolean(rows[0]?.allowed);
  }
  const rows = await sql<{ allowed: boolean }[]>`
    select exists(
      select 1 from orders
      where id = ${orderId} and lower(brand) = ${operator.user.role}
    ) as allowed
  `;
  return Boolean(rows[0]?.allowed);
}
