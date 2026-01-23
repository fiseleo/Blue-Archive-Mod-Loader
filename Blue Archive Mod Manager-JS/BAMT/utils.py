# utils.py

import tkinter as tk
from i18n import t


class Logger:
    def __init__(self, master, log_widget: tk.Text, status_widget: tk.Label):
        self.master = master
        self.log_widget = log_widget
        self.status_widget = status_widget

    def log(self, message):
        """线程安全地向日志区域添加消息"""
        def _update_log():
            self.log_widget.config(state=tk.NORMAL)
            self.log_widget.insert(tk.END, message + "\n")
            self.log_widget.see(tk.END)
            self.log_widget.config(state=tk.DISABLED)
        
        self.master.after(0, _update_log)

    def status(self, message):
        """线程安全地更新状态栏消息"""
        def _update_status():
            self.status_widget.config(text=t('bamt.utils.status', message=message))
        
        self.master.after(0, _update_status)

    def clear(self):
        """清空日志区域"""
        def _clear_log():
            self.log_widget.config(state=tk.NORMAL)
            self.log_widget.delete('1.0', tk.END)
            self.log_widget.config(state=tk.DISABLED)
        
        self.master.after(0, _clear_log)