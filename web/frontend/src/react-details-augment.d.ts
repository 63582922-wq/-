import "react";

declare module "react" {
  interface DetailsHTMLAttributes<T> extends HTMLAttributes<T> {
    /** 与 DOM 一致；部分 @types/react 版本未声明。 */
    defaultOpen?: boolean;
  }
}
