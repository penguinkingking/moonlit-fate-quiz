import type { Metadata } from 'next';
import './globals.css';
import './portrait-backgrounds.css';
export const metadata: Metadata = {title:'月下心笺 · 寻找你的命定角色',description:'16道心动情境，13位《魔鬼恋人》角色。循着直觉，发现属于你的月夜邂逅与细致心动解析。同人娱乐测试。'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN" className="dark"><body>{children}</body></html>}
