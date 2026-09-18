/**
 * Inline SVG icons mirroring the Material icons used by HMCL's sidebar.
 */

interface IconProps {
  size?: number;
}

function Svg({ size = 20, path }: IconProps & { path: string }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function PersonIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
    />
  );
}

export function GameIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM11 13H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
    />
  );
}

export function ListIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"
    />
  );
}

export function DownloadIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
    />
  );
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
    />
  );
}

export function TerminalIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM8.7 14.3 7.3 15.7 3.6 12l3.7-3.7 1.4 1.4L6.4 12l2.3 2.3zm6.6 1.4-1.4-1.4 2.3-2.3-2.3-2.3 1.4-1.4L19.4 12l-4.1 3.7z"
    />
  );
}

export function ArrowUpIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props} path="M7 14l5-5 5 5z" />
  );
}

export function PlayIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props} path="M8 5v14l11-7z" />;
}

/** HMCL SVG.STADIA_CONTROLLER */
export function GamepadIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M4.725 20Q3.225 20 2.1625 18.925T1.05 16.325Q1.05 16.1 1.075 15.875T1.15 15.425L3.25 7.025Q3.6 5.675 4.675 4.8375T7.125 4H16.875Q18.25 4 19.325 4.8375T20.75 7.025L22.85 15.425Q22.9 15.65 22.9375 15.8875T22.975 16.35Q22.975 17.875 21.8875 18.9375T19.275 20Q18.225 20 17.325 19.45T15.975 17.95L15.275 16.5Q15.15 16.25 14.9 16.125T14.375 16H9.625Q9.35 16 9.1 16.125T8.725 16.5L8.025 17.95Q7.575 18.9 6.675 19.45T4.725 20ZM4.8 18Q5.275 18 5.6625 17.75T6.25 17.075L6.95 15.65Q7.325 14.875 8.05 14.4375T9.625 14H14.375Q15.225 14 15.95 14.45T17.075 15.65L17.775 17.075Q17.975 17.5 18.3625 17.75T19.225 18Q19.925 18 20.425 17.5375T20.95 16.375Q20.95 16.4 20.9 15.9L18.8 7.525Q18.625 6.85 18.1 6.425T16.875 6H7.125Q6.425 6 5.8875 6.425T5.2 7.525L3.1 15.9Q3.05 16.05 3.05 16.35 3.05 17.05 3.5625 17.525T4.8 18ZM13.5 11Q13.925 11 14.2125 10.7125T14.5 10Q14.5 9.575 14.2125 9.2875T13.5 9Q13.075 9 12.7875 9.2875T12.5 10Q12.5 10.425 12.7875 10.7125T13.5 11ZM15.5 9Q15.925 9 16.2125 8.7125T16.5 8Q16.5 7.575 16.2125 7.2875T15.5 7Q15.075 7 14.7875 7.2875T14.5 8Q14.5 8.425 14.7875 8.7125T15.5 9ZM15.5 13Q15.925 13 16.2125 12.7125T16.5 12Q16.5 11.575 16.2125 11.2875T15.5 11Q15.075 11 14.7875 11.2875T14.5 12Q14.5 12.425 14.7875 12.7125T15.5 13ZM17.5 11Q17.925 11 18.2125 10.7125T18.5 10Q18.5 9.575 18.2125 9.2875T17.5 9Q17.075 9 16.7875 9.2875T16.5 10Q16.5 10.425 16.7875 10.7125T17.5 11ZM8.5 12.5Q8.825 12.5 9.0375 12.2875T9.25 11.75V10.75H10.25Q10.575 10.75 10.7875 10.5375T11 10Q11 9.675 10.7875 9.4625T10.25 9.25H9.25V8.25Q9.25 7.925 9.0375 7.7125T8.5 7.5Q8.175 7.5 7.9625 7.7125T7.75 8.25V9.25H6.75Q6.425 9.25 6.2125 9.4625T6 10Q6 10.325 6.2125 10.5375T6.75 10.75H7.75V11.75Q7.75 12.075 7.9625 12.2875T8.5 12.5ZM12 12Z"
    />
  );
}

/** HMCL SVG.STADIA_CONTROLLER_FILL */
export function GamepadFillIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M4.725 20q-1.5 0-2.5625-1.075T1.05 16.325q0-.225.025-.45t.075-.45l2.1-8.4q.35-1.35 1.425-2.1875T7.125 4h9.75q1.375 0 2.45.8375T20.75 7.025l2.1 8.4q.05.225.0875.4625t.0375.4625q0 1.525-1.0875 2.5875T19.275 20q-1.05 0-1.95-.55t-1.35-1.5l-.7-1.45q-.125-.25-.375-.375T14.375 16H9.625q-.275 0-.525.125t-.375.375l-.7 1.45q-.45.95-1.35 1.5T4.725 20ZM13.5 11q.425 0 .7125-.2875T14.5 10t-.2875-.7125T13.5 9t-.7125.2875T12.5 10t.2875.7125T13.5 11Zm2-2q.425 0 .7125-.2875T16.5 8q0-.425-.2875-.7125T15.5 7q-.425 0-.7125.2875T14.5 8t.2875.7125T15.5 9Zm0 4q.425 0 .7125-.2875T16.5 12q0-.425-.2875-.7125T15.5 11q-.425 0-.7125.2875T14.5 12t.2875.7125T15.5 13Zm2-2q.425 0 .7125-.2875T18.5 10q0-.425-.2875-.7125T17.5 9q-.425 0-.7125.2875T16.5 10q0 .425.2875.7125T17.5 11Zm-9 1.5q.325 0 .5375-.2125T9.25 11.75v-1h1q.325 0 .5375-.2125T11 10t-.2125-.5375T10.25 9.25h-1v-1q0-.325-.2125-.5375T8.5 7.5q-.325 0-.5375.2125T7.75 8.25v1h-1q-.325 0-.5375.2125T6 10q0 .325.2125.5375T6.75 10.75h1v1q0 .325.2125.5375T8.5 12.5Z"
    />
  );
}

/** HMCL SVG.PACKAGE2 */
export function PackageIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M11 19.425V12.575L5 9.1V15.95L11 19.425ZM13 19.425 19 15.95V9.1L13 12.575V19.425ZM11 21.725 4 17.7Q3.525 17.425 3.2625 16.975T3 15.975V8.025Q3 7.475 3.2625 7.025T4 6.3L11 2.275Q11.475 2 12 2T13 2.275L20 6.3Q20.475 6.575 20.7375 7.025T21 8.025V15.975Q21 16.525 20.7375 16.975T20 17.7L13 21.725Q12.525 22 12 22T11 21.725ZM16 8.525 17.925 7.425 12 4 10.05 5.125 16 8.525ZM12 10.85 13.95 9.725 8.025 6.3 6.075 7.425 12 10.85Z"
    />
  );
}

/** HMCL SVG.PACKAGE2_FILL */
export function PackageFillIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M11 21.725v-9.15L3 7.95v8.025q0 .55.2625 1T4 17.7l7 4.025Zm2 0L20 17.7q.475-.275.7375-.725t.2625-1V7.95l-8 4.625v9.15Zm3.975-13.75 2.95-1.725L13 2.275Q12.525 2 12 2t-1 .275L9.025 3.4l7.95 4.575ZM12 10.85l2.975-1.7L7.05 4.55l-3 1.725L12 10.85Z"
    />
  );
}

/** HMCL SVG.EXTENSION */
export function ExtensionIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M8.8 21H5Q4.175 21 3.5875 20.4125T3 19V15.2Q4.2 15.2 5.1 14.4375T6 12.5Q6 11.325 5.1 10.5625T3 9.8V6Q3 5.175 3.5875 4.5875T5 4H9Q9 2.95 9.725 2.225T11.5 1.5Q12.55 1.5 13.275 2.225T14 4H18Q18.825 4 19.4125 4.5875T20 6V10Q21.05 10 21.775 10.725T22.5 12.5Q22.5 13.55 21.775 14.275T20 15V19Q20 19.825 19.4125 20.4125T18 21H14.2Q14.2 19.75 13.4125 18.875T11.5 18Q10.375 18 9.5875 18.875T8.8 21ZM5 19H7.125Q7.725 17.35 9.05 16.675T11.5 16Q12.625 16 13.95 16.675T15.875 19H18V13H20Q20.2 13 20.35 12.85T20.5 12.5Q20.5 12.3 20.35 12.15T20 12H18V6H12V4Q12 3.8 11.85 3.65T11.5 3.5Q11.3 3.5 11.15 3.65T11 4V6H5V8.2Q6.35 8.7 7.175 9.875T8 12.5Q8 13.925 7.175 15.1T5 16.8V19ZM11.5 12.5Z"
    />
  );
}

/** HMCL SVG.EXTENSION_FILL */
export function ExtensionFillIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M8.8 21H5q-.825 0-1.4125-.5875T3 19V15.2q1.2 0 2.1-.7625T6 12.5q0-1.175-.9-1.9375T3 9.8V6q0-.825.5875-1.4125T5 4H9q0-1.05.725-1.775T11.5 1.5q1.05 0 1.775.725T14 4h4q.825 0 1.4125.5875T20 6v4q1.05 0 1.775.725T22.5 12.5q0 1.05-.725 1.775T20 15v4q0 .825-.5875 1.4125T18 21H14.2q0-1.25-.7875-2.125T11.5 18q-1.125 0-1.9125.875T8.8 21Z"
    />
  );
}

/** HMCL SVG.TEXTURE */
export function TextureIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M4.4 21q-.475-.1-.8875-.5125T3 19.6L19.6 3q.525.125.9.5125t.525.8875L4.4 21ZM3 14.7v-2.8L11.9 3h2.8L3 14.7ZM3 7V5q0-.825.5875-1.4125T5 3h2L3 7Zm14 14 4-4v2q0 .825-.5875 1.4125T19 21h-2Zm-7.7 0L21 9.3v2.8L12.1 21H9.3Z"
    />
  );
}

/** HMCL SVG.WB_SUNNY */
export function SunnyIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M11 4V1H13V4H11ZM11 23V20H13V23H11ZM20 13V11H23V13H20ZM1 13V11H4V13H1ZM18.7 6.7 17.3 5.3 19.05 3.5 20.5 4.95 18.7 6.7ZM4.95 20.5 3.5 19.05 5.3 17.3 6.7 18.7 4.95 20.5ZM19.05 20.5 17.3 18.7 18.7 17.3 20.5 19.05 19.05 20.5ZM5.3 6.7 3.5 4.95 4.95 3.5 6.7 5.3 5.3 6.7ZM12 18Q9.5 18 7.75 16.25T6 12Q6 9.5 7.75 7.75T12 6Q14.5 6 16.25 7.75T18 12Q18 14.5 16.25 16.25T12 18ZM12 16Q13.675 16 14.8375 14.8375T16 12Q16 10.325 14.8375 9.1625T12 8Q10.325 8 9.1625 9.1625T8 12Q8 13.675 9.1625 14.8375T12 16ZM12 12Z"
    />
  );
}

/** HMCL SVG.WB_SUNNY_FILL */
export function SunnyFillIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M11 4V1h2V4H11Zm0 19V20h2v3H11Zm9-10V11h3v2H20ZM1 13V11H4v2H1ZM18.7 6.7 17.3 5.3l1.75-1.8L20.5 4.95 18.7 6.7ZM4.95 20.5 3.5 19.05 5.3 17.3l1.4 1.4-1.75 1.8Zm14.1 0-1.75-1.8 1.4-1.4 1.8 1.75-1.45 1.45ZM5.3 6.7 3.5 4.95 4.95 3.5 6.7 5.3 5.3 6.7ZM12 18q-2.5 0-4.25-1.75T6 12 7.75 7.75 12 6t4.25 1.75T18 12t-1.75 4.25T12 18Z"
    />
  );
}

/** HMCL SVG.PUBLIC */
export function PublicIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M12 22Q9.925 22 8.1 21.2125T4.925 19.075Q3.575 17.725 2.7875 15.9T2 12Q2 9.925 2.7875 8.1T4.925 4.925Q6.275 3.575 8.1 2.7875T12 2Q14.075 2 15.9 2.7875T19.075 4.925Q20.425 6.275 21.2125 8.1T22 12Q22 14.075 21.2125 15.9T19.075 19.075Q17.725 20.425 15.9 21.2125T12 22ZM11 19.95V18Q10.175 18 9.5875 17.4125T9 16V15L4.2 10.2Q4.125 10.65 4.0625 11.1T4 12Q4 15.025 5.9875 17.3T11 19.95ZM17.9 17.4Q18.925 16.275 19.4625 14.8875T20 12Q20 9.55 18.6375 7.525T15 4.6V5Q15 5.825 14.4125 6.4125T13 7H11V9Q11 9.425 10.7125 9.7125T10 10H8V12H14Q14.425 12 14.7125 12.2875T15 13V16H16Q16.65 16 17.175 16.3875T17.9 17.4Z"
    />
  );
}

/** HMCL SVG.GLOBE_BOOK (wiki) */
export function WikiIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M3.075 13Q3.05 12.75 3.0375 12.5T3.025 12Q3.025 10.125 3.725 8.4875T5.65 5.6375Q6.875 4.425 8.5 3.7125T12 3Q13.875 3 15.5125 3.7125T18.3625 5.6375Q19.575 6.85 20.2875 8.4875T21 12Q21 12.25 20.9875 12.5T20.95 13H18.925Q18.975 12.75 18.9875 12.5T19 12Q19 11.75 18.9875 11.5T18.925 11H15.975Q16 11.25 16 11.5V12.5Q16 12.75 15.975 13H14V12.175Q14 11.875 13.9875 11.575T13.95 11H10.075Q10.05 11.275 10.0375 11.575T10.025 12.175V13H8.05Q8.025 12.75 8.025 12.5V11.5Q8.025 11.25 8.05 11H5.1Q5.05 11.25 5.0375 11.5T5.025 12Q5.025 12.25 5.0375 12.5T5.1 13H3.075ZM5.7 9H8.275Q8.475 7.925 8.775 7.0625T9.425 5.5Q8.225 5.95 7.25 6.8625T5.7 9ZM10.35 9H13.65Q13.4 7.925 13.025 6.9T12 5Q11.35 5.875 10.9625 6.9T10.35 9ZM15.75 9H18.325Q17.75 7.775 16.7625 6.8625T14.575 5.5Q14.925 6.25 15.2375 7.0875T15.75 9ZM11 21V20Q11 18.75 10.125 17.875T8 17H2V15H8Q9.2 15 10.2375 15.525T12 17Q12.725 16.05 13.7625 15.525T16 15H22V17H16Q14.75 17 13.875 17.875T13 20V21H11Z"
    />
  );
}

/** HMCL SVG.ARROW_FORWARD */
export function ArrowForwardIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M16.175 13H4V11H16.175L10.575 5.4 12 4 20 12 12 20 10.575 18.6 16.175 13Z"
    />
  );
}

/** HMCL SVG.MICROSOFT (four-pane Windows logo) */
export function MicrosoftIcon(props: IconProps): React.JSX.Element {
  return <Svg {...props} path="M4 20H22v2H4V13H20v7h2V4H20v7H4V4h7V20h2V4h9V2H2V22H4" />;
}

/** HMCL SVG.REFRESH */
export function RefreshIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M12 20Q8.65 20 6.325 17.675T4 12Q4 8.65 6.325 6.325T12 4Q13.725 4 15.3 4.7125T18 6.75V4H20V11H13V9H17.2Q16.4 7.6 15.0125 6.8T12 6Q9.5 6 7.75 7.75T6 12Q6 14.5 7.75 16.25T12 18Q13.925 18 15.475 16.9T17.65 14H19.75Q19.05 16.65 16.9 18.325T12 20Z"
    />
  );
}

/** HMCL SVG.CONTENT_COPY (copy UUID) */
export function ContentCopyIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M9 18Q8.175 18 7.5875 17.4125T7 16V4Q7 3.175 7.5875 2.5875T9 2H18Q18.825 2 19.4125 2.5875T20 4V16Q20 16.825 19.4125 17.4125T18 18H9ZM9 16H18V4H9V16ZM5 22Q4.175 22 3.5875 21.4125T3 20V6H5V20H16V22H5ZM9 16V4 16Z"
    />
  );
}

/** HMCL SVG.DELETE_FOREVER */
export function DeleteForeverIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M9.4 16.5 12 13.9 14.6 16.5 16 15.1 13.4 12.5 16 9.9 14.6 8.5 12 11.1 9.4 8.5 8 9.9 10.6 12.5 8 15.1 9.4 16.5ZM7 21Q6.175 21 5.5875 20.4125T5 19V6H4V4H9V3H15V4H20V6H19V19Q19 19.825 18.4125 20.4125T17 21H7ZM17 6H7V19H17V6ZM7 6V19 6Z"
    />
  );
}

/** HMCL SVG.CHECKROOM (upload skin) */
export function CheckroomIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M3 20Q2.575 20 2.2875 19.7125T2 19Q2 18.75 2.1 18.5375T2.4 18.2L11 11.75V10Q11 9.575 11.3 9.2875T12.025 9Q12.65 9 13.075 8.55T13.5 7.475Q13.5 6.85 13.0625 6.425T12 6Q11.375 6 10.9375 6.4375T10.5 7.5H8.5Q8.5 6.05 9.525 5.025T12 4Q13.45 4 14.475 5.0125T15.5 7.475Q15.5 8.65 14.8125 9.575T13 10.85V11.75L21.6 18.2Q21.8 18.325 21.9 18.5375T22 19Q22 19.425 21.7125 19.7125T21 20H3ZM6 18H18L12 13.5 6 18Z"
    />
  );
}

/** HMCL SVG.MINIMIZE_CENTER (window minimize button) */
export function MinimizeIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M6 13v-2h12v2H6Z"
    />
  );
}

/** HMCL SVG.CLOSE (window close button) */
export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M6.4 19 5 17.6 10.6 12 5 6.4 6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19Z"
    />
  );
}

/** Window maximize button (drawn outline square, HMCL-style stroke) */
export function MaximizeIcon(props: IconProps): React.JSX.Element {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Window restore button (two overlapping squares, HMCL-style stroke) */
export function RestoreIcon(props: IconProps): React.JSX.Element {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v11h11V9z" stroke="currentColor" strokeWidth="2" />
      <path d="M9 4h11v11h-4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Coffee mug, matching HMCL's Java 管理 sidebar icon (material local_cafe). */
export function CoffeeIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M2 21h18v-2H2v2zM20 8V5H4v3c0 2.76 2.24 5 5 5h6c2.76 0 5-2.24 5-5zm-9 3c-1.66 0-3-1.34-3-3V7h6v1c0 1.66-1.34 3-3 3zm5-9H8v1h8V2z"
    />
  );
}

/** Flat palette, matching HMCL's 个性化 sidebar icon (material palette). */
export function PaletteIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7zM6.5 12c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
    />
  );
}

/** Information circle, matching HMCL's 关于 sidebar icon (material info). */
export function InfoIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
    />
  );
}

/** Left arrow, HMCL's Decorator back navigation icon (material arrow_back). */
export function ArrowBackIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"
    />
  );
}

/** Vertical ellipsis, HMCL instance-card management menu icon (material more_vert). */
export function MoreVertIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
    />
  );
}

/** Pencil, instance rename menu icon (material edit). */
export function EditIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
    />
  );
}

/** Rocket, HMCL instance test-launch button icon (material rocket_launch). */
export function RocketIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M6 15c-.83 0-1.58.34-2.12.88C2.7 17.06 2 22 2 22s4.94-.7 6.12-1.88A2.996 2.996 0 0 0 6 15zm.71 3.71c-.28.28-2.17.76-2.17.76s.47-1.88.76-2.17c.17-.19.42-.3.7-.3a1.003 1.003 0 0 1 .71 1.71zm10.71-5.06c6.36-6.36 4.24-11.31 4.24-11.31S16.71.22 10.35 6.58l-2.49-.5a2.03 2.03 0 0 0-1.81.55L2 10.69l5 2.14L11.17 17l2.14 5 4.05-4.05c.47-.47.68-1.15.55-1.81l-.49-2.49zM7.41 10.83l-1.91-.82 1.97-1.97 1.44.29c-.57.83-1.08 1.7-1.5 2.5zm6.58 7.67-.82-1.91c.8-.42 1.67-.93 2.49-1.5l.29 1.44-1.96 1.97zM16 12.24c-1.32 1.32-3.38 2.4-4.04 2.73l-2.93-2.93c.32-.65 1.4-2.71 2.73-4.04 4.68-4.68 8.23-3.99 8.23-3.99s.69 3.55-3.99 8.23zM15 11c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"
    />
  );
}

/** Circular refresh arrows, HMCL modpack update button icon (material update). */
export function UpdateIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg
      {...props}
      path="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.03 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58 3.51-3.47 9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"
    />
  );
}
