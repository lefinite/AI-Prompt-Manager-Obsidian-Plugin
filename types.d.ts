// 为window.moment添加类型声明
declare interface Window {
  moment?: {
    locale(): string;
  };
}