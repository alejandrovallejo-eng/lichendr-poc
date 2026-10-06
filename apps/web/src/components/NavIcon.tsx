import type { NavItem } from "@/config/navigation";
const paths: Record<NavItem["icon"], string> = {
  home: "m3 10 9-7 9 7v10H3Z M9 20v-7h6v7",
  field: "M5 5h14v16H5Z M9 3h6v4H9Z M9 12h6 M9 16h4",
  folder: "M3 5h7l2 3h9v12H3Z",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  calendar: "M4 5h16v16H4Z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M14 14h2",
  tree: "m12 2-7 8h3l-5 7h18l-5-7h3Z M12 17v5",
  camera: "M3 7h5l2-3h4l2 3h5v13H3Z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  edit: "m4 16 11-11 4 4L8 20H4Z M13 7l4 4",
  chart: "M4 3v17h17 M8 15v-4 M13 15V7 M18 15v-6",
  leaf: "M20 3C7 2 3 9 6 16s16 4 14-13Z M5 21 17 8",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
};
export default function NavIcon({ name }: { name: NavItem["icon"] }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
