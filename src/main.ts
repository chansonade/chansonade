import { mount } from 'svelte';
import App from './App.svelte';
import { migrateLocalSettings } from './lib/storage';
import { initializeTheme } from './lib/theme';
import './style.css';

migrateLocalSettings();
initializeTheme();
mount(App, { target: document.getElementById('app')! });
