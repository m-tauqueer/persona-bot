/**
 * Personal vs admin nav: everyone sees the same personal items;
 * only the owner extra list includes Admin.
 */
import { adminNav, isAdminPath, isPersonalPath, loadNavConfig, personalNav } from "./nav";
import { ROUTES } from "./routes";

let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`${name}=ok${detail ? ` ${detail}` : ""}`);
    return;
  }
  console.error(`${name}=FAIL${detail ? ` ${detail}` : ""}`);
  failed += 1;
}

const nav = loadNavConfig();
const memberItems = personalNav(false);
const ownerPersonal = personalNav(true);
const ownerAdmin = adminNav();

console.log(`member_nav=${memberItems.map((item) => item.label).join(",")}`);
console.log(`owner_personal_nav=${ownerPersonal.map((item) => item.label).join(",")}`);
console.log(`admin_nav=${ownerAdmin.map((item) => item.label).join(",")}`);

check("member_nav_not_empty", memberItems.length > 0);
check("admin_nav_not_empty", nav.adminItems.length > 0);
check(
  "member_matches_personal_items",
  memberItems.length === nav.items.length &&
    memberItems.every((item, index) => item.id === nav.items[index]?.id),
);
check(
  "owner_extra_not_in_member",
  nav.ownerItems.every(
    (extra) => !memberItems.some((item) => item.id === extra.id),
  ),
);
check(
  "owner_sees_extra",
  nav.ownerItems.every((extra) =>
    ownerPersonal.some((item) => item.id === extra.id),
  ),
);
check(
  "admin_entry_is_admin_path",
  nav.ownerItems.every((item) => isAdminPath(item.to)),
);
check(
  "personal_items_are_not_admin",
  nav.items.every((item) => !isAdminPath(item.to)),
);
check(
  "admin_overview_is_admin_root",
  nav.adminItems.some((item) => item.to === ROUTES.admin),
);
check(
  "admin_has_app_entry",
  nav.adminAppItems.every((extra) =>
    ownerAdmin.some((item) => item.id === extra.id),
  ) && nav.adminAppItems.every((item) => isPersonalPath(item.to)),
);

if (failed) {
  console.error(`FAIL: ${failed} check(s)`);
  process.exit(1);
}
console.log("PROBE_OK");
