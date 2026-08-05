import { redirect } from "next/navigation";

// Feed used to live at "/" — removed from the nav (Scan, Wallet Passport,
// and Constellation are the real, working product now), so the root route
// redirects straight to Scan instead of showing an unreachable page.
export default function RootPage() {
  redirect("/scan");
}
