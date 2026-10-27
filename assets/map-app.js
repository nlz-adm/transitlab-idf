// Correction du gestionnaire d'événements des boutons de mode de transport
// Remplacer l'ancien bloc document.querySelectorAll('#customModePicker [data-mode]')... par celui-ci :

document.querySelectorAll('#customModePicker [data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    const selectedMode = button.dataset.mode;
    
    // 1. Mettre à jour la valeur du select caché
    modeInput.value = selectedMode;
    
    // 2. Mettre à jour l'état visuel de TOUS les boutons (classe et accessibilité)
    document.querySelectorAll('#customModePicker [data-mode]').forEach(btn => {
      const isSelected = btn.dataset.mode === selectedMode;
      btn.classList.toggle('selected', isSelected);
      btn.setAttribute('aria-pressed', isSelected);
    });
    
    // 3. Mettre à jour immédiatement l'aperçu visuel (couleur et logo) même si aucune ligne n'est active
    colorInput.value = customModeColors[selectedMode] || '#314f88';
    refreshCustomLineLogo({ mode: selectedMode, color: colorInput.value });
    
    // 4. Déclencher l'événement change pour mettre à jour la ligne active si elle existe
    modeInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
});