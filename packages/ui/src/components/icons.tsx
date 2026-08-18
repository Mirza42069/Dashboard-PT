/**
 * Every icon in the app, as components.
 *
 * Hugeicons ships its icons as data, not components — the library's own shape is
 * `<HugeiconsIcon icon={Delete02Icon} />`. Wrapping that once here keeps every
 * call site as `<Trash2 className="size-4" />`, which is what the ~99 of them
 * already looked like under lucide, and keeps the `icon: typeof UserRound` prop
 * type used by app-nav.tsx and settings-sections.tsx working — a bare icon
 * object is not a component and cannot satisfy it.
 *
 * The exported names are the lucide names this replaced. That is deliberate:
 * it made the swap a one-line import change per file rather than an edit to
 * every JSX tag, and it means an icon can be re-pointed at a different glyph by
 * editing one line here instead of hunting call sites. Some (`Trash2`,
 * `Loader2`, `House`) read as lucide-isms; they are just local names now.
 *
 * No "use client" — HugeiconsIcon is forwardRef with no hooks, so these work in
 * server components exactly as lucide's did.
 *
 * Sizing is unchanged: HugeiconsIcon renders width/height attributes of 24, and
 * a `size-4` class overrides them because CSS beats presentation attributes.
 * shadcn's `[&_svg]:size-4` selectors keep working for the same reason.
 *
 * Imports are aliased `Hi*` because the two libraries share some names
 * (OctagonXIcon exists in both) and because named imports rather than a
 * namespace import keep the other ~5,380 icons in the package tree-shakeable.
 */

import {
  AccessibilityIcon as HiAccessibility,
  Add01Icon as HiAdd01,
  AiFileIcon as HiAiFile,
  Alert02Icon as HiAlert02,
  AlertCircleIcon as HiAlertCircle,
  ArrowDown01Icon as HiArrowDown01,
  ArrowLeft01Icon as HiArrowLeft01,
  ArrowRight01Icon as HiArrowRight01,
  ArrowUp01Icon as HiArrowUp01,
  Building03Icon as HiBuilding03,
  Calendar03Icon as HiCalendar03,
  Cancel01Icon as HiCancel01,
  ChartUpIcon as HiChartUp,
  CheckListIcon as HiCheckList,
  CheckmarkCircle02Icon as HiCheckmarkCircle02,
  CircleSlashTwoIcon as HiCircleSlashTwo,
  Copy01Icon as HiCopy01,
  DashboardSquare01Icon as HiDashboardSquare01,
  DashedLineCircleIcon as HiDashedLineCircle,
  Delete02Icon as HiDelete02,
  Download01Icon as HiDownload01,
  Edit02Icon as HiEdit02,
  FileQuestionMarkIcon as HiFileQuestionMark,
  FloppyDiskIcon as HiFloppyDisk,
  HammerIcon as HiHammer,
  HardHatIcon as HiHardHat,
  Home01Icon as HiHome01,
  ImageAdd01Icon as HiImageAdd01,
  InboxIcon as HiInbox,
  InformationCircleIcon as HiInformationCircle,
  JusticeScale01Icon as HiJusticeScale01,
  Key01Icon as HiKey01,
  Loading03Icon as HiLoading03,
  LockIcon as HiLock,
  Logout01Icon as HiLogout01,
  Menu01Icon as HiMenu01,
  Moon02Icon as HiMoon02,
  MoreHorizontalIcon as HiMoreHorizontal,
  OctagonXIcon as HiOctagonX,
  PaintBoardIcon as HiPaintBoard,
  PauseCircleIcon as HiPauseCircle,
  PlayCircleIcon as HiPlayCircle,
  RecordIcon as HiRecord,
  RefreshIcon as HiRefresh,
  Remove01Icon as HiRemove01,
  Rotate01Icon as HiRotate01,
  SearchRemoveIcon as HiSearchRemove,
  SentIcon as HiSent,
  Settings02Icon as HiSettings02,
  ShieldMinusIcon as HiShieldMinus,
  ShieldPlusIcon as HiShieldPlus,
  SlidersHorizontalIcon as HiSlidersHorizontal,
  Sun03Icon as HiSun03,
  Tick02Icon as HiTick02,
  TranslateIcon as HiTranslate,
  Upload01Icon as HiUpload01,
  UserAdd01Icon as HiUserAdd01,
  UserIcon as HiUser,
  UserMultipleIcon as HiUserMultiple,
  ViewIcon as HiView,
  ViewOffIcon as HiViewOff,
  Wallet01Icon as HiWallet01,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

type Glyph = ComponentProps<typeof HugeiconsIcon>["icon"];

/** Props are HugeiconsIcon's minus the icon it is bound to. */
export type IconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;

function icon(glyph: Glyph, name: string) {
  function Icon(props: IconProps) {
    /*
     * aria-hidden by default, and it has to be set here rather than left to
     * call sites. lucide did this automatically — its Icon applied
     * `aria-hidden="true"` whenever the icon had no children and no a11y prop
     * of its own — and HugeiconsIcon does not, so dropping it in the swap would
     * have exposed every one of these to screen readers. Icon-only buttons in
     * this app already carry their own aria-label, so the icon inside would be
     * announced a second time with no name to give.
     *
     * Before the spread on purpose: an icon that ever needs to carry its own
     * name can pass aria-hidden={false} with an aria-label and win.
     *
     * Glyph *size* is deliberately not set here. Putting a `size-*` class on the
     * icon would satisfy the `:not([class*='size-'])` guard in every component's
     * sizing rule and so override all of them at once — a 16px glyph inside a
     * 24px `icon-xs` button. The defaults live in those components instead.
     *
     * `strokeWidth` is left alone for the same reason it is not a size: Hugeicons'
     * own 1.5 is the weight the set is drawn at, and overriding it here changed
     * every glyph in the product at once. A call site that wants a heavier line
     * can still pass its own.
     */
    return <HugeiconsIcon icon={glyph} aria-hidden {...props} />;
  }
  // Without this every icon shows as "Icon" in React DevTools.
  Icon.displayName = name;
  return Icon;
}

export const Accessibility = icon(HiAccessibility, "Accessibility");
export const AiFile = icon(HiAiFile, "AiFile");
export const ArrowDownIcon = icon(HiArrowDown01, "ArrowDownIcon");
export const ArrowLeft = icon(HiArrowLeft01, "ArrowLeft");
export const Building2 = icon(HiBuilding03, "Building2");
export const CalendarRange = icon(HiCalendar03, "CalendarRange");
export const Check = icon(HiTick02, "Check");
export const CheckCircle2 = icon(HiCheckmarkCircle02, "CheckCircle2");
export const CheckIcon = icon(HiTick02, "CheckIcon");
export const ChevronDown = icon(HiArrowDown01, "ChevronDown");
export const ChevronDownIcon = icon(HiArrowDown01, "ChevronDownIcon");
export const ChevronLeft = icon(HiArrowLeft01, "ChevronLeft");
export const ChevronRight = icon(HiArrowRight01, "ChevronRight");
export const ChevronRightIcon = icon(HiArrowRight01, "ChevronRightIcon");
export const ChevronUp = icon(HiArrowUp01, "ChevronUp");
export const ChevronUpIcon = icon(HiArrowUp01, "ChevronUpIcon");
export const CircleAlert = icon(HiAlertCircle, "CircleAlert");
export const CircleCheck = icon(HiCheckmarkCircle02, "CircleCheck");
export const CircleCheckIcon = icon(HiCheckmarkCircle02, "CircleCheckIcon");
export const CircleDashed = icon(HiDashedLineCircle, "CircleDashed");
export const CircleDot = icon(HiRecord, "CircleDot");
export const CircleSlash = icon(HiCircleSlashTwo, "CircleSlash");
export const Copy = icon(HiCopy01, "Copy");
export const Download = icon(HiDownload01, "Download");
export const Eye = icon(HiView, "Eye");
export const EyeOff = icon(HiViewOff, "EyeOff");
export const FileQuestionMark = icon(HiFileQuestionMark, "FileQuestionMark");
export const Hammer = icon(HiHammer, "Hammer");
export const HardHat = icon(HiHardHat, "HardHat");
export const House = icon(HiHome01, "House");
export const ImagePlus = icon(HiImageAdd01, "ImagePlus");
export const Inbox = icon(HiInbox, "Inbox");
export const InfoIcon = icon(HiInformationCircle, "InfoIcon");
export const KeyRound = icon(HiKey01, "KeyRound");
export const Languages = icon(HiTranslate, "Languages");
export const LayoutDashboard = icon(HiDashboardSquare01, "LayoutDashboard");
export const ListChecks = icon(HiCheckList, "ListChecks");
export const Loader2 = icon(HiLoading03, "Loader2");
export const Loader2Icon = icon(HiLoading03, "Loader2Icon");
export const Lock = icon(HiLock, "Lock");
export const LogOut = icon(HiLogout01, "LogOut");
export const Menu = icon(HiMenu01, "Menu");
export const MinusIcon = icon(HiRemove01, "MinusIcon");
export const Moon = icon(HiMoon02, "Moon");
export const MoreHorizontal = icon(HiMoreHorizontal, "MoreHorizontal");
export const OctagonX = icon(HiOctagonX, "OctagonX");
export const OctagonXIcon = icon(HiOctagonX, "OctagonXIcon");
export const Palette = icon(HiPaintBoard, "Palette");
export const PauseCircle = icon(HiPauseCircle, "PauseCircle");
export const Pencil = icon(HiEdit02, "Pencil");
export const PlayCircle = icon(HiPlayCircle, "PlayCircle");
export const Plus = icon(HiAdd01, "Plus");
export const RefreshCw = icon(HiRefresh, "RefreshCw");
export const RotateCcw = icon(HiRotate01, "RotateCcw");
export const Save = icon(HiFloppyDisk, "Save");
export const Scale = icon(HiJusticeScale01, "Scale");
export const SearchX = icon(HiSearchRemove, "SearchX");
export const Send = icon(HiSent, "Send");
export const Settings = icon(HiSettings02, "Settings");
export const ShieldMinus = icon(HiShieldMinus, "ShieldMinus");
export const ShieldPlus = icon(HiShieldPlus, "ShieldPlus");
export const SlidersHorizontal = icon(HiSlidersHorizontal, "SlidersHorizontal");
export const Sun = icon(HiSun03, "Sun");
export const Trash2 = icon(HiDelete02, "Trash2");
export const TrendingUp = icon(HiChartUp, "TrendingUp");
export const TriangleAlert = icon(HiAlert02, "TriangleAlert");
export const TriangleAlertIcon = icon(HiAlert02, "TriangleAlertIcon");
export const Upload = icon(HiUpload01, "Upload");
export const UserPlus = icon(HiUserAdd01, "UserPlus");
export const UserRound = icon(HiUser, "UserRound");
export const Users = icon(HiUserMultiple, "Users");
export const Wallet = icon(HiWallet01, "Wallet");
export const X = icon(HiCancel01, "X");
export const XIcon = icon(HiCancel01, "XIcon");
