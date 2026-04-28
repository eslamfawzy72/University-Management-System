export function BtnPrimary({ className = "", type = "button", ...props }) {
  return <button type={type} className={`btn btn-primary ${className}`.trim()} {...props} />;
}

export function BtnGhost({ className = "", type = "button", ...props }) {
  return <button type={type} className={`btn btn-ghost ${className}`.trim()} {...props} />;
}
