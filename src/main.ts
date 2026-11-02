import { mount } from 'svelte';
import App from './App.svelte';
import { migrateLocalSettings } from './lib/storage';
import { initializeTheme } from './lib/theme';
import { initializeLanguage } from './lib/i18n';
import './style.css';

migrateLocalSettings();
initializeTheme();
initializeLanguage();
mount(App, { target: document.getElementById('app')! });
