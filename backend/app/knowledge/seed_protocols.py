DIABETES_PROTOCOL = {
    "assessment_questions": [
        {"id": "fasting_glucose", "text": "Have you checked your fasting blood sugar recently? What was the result?", "category": "symptom"},
        {"id": "fatigue", "text": "Have you experienced unusual fatigue or weakness?", "category": "symptom"},
        {"id": "thirst", "text": "Have you had increased thirst or frequent urination?", "category": "symptom"},
        {"id": "medication_adherence", "text": "Have you been taking your diabetes medications as prescribed?", "category": "adherence"},
        {"id": "diet", "text": "How would you describe your diet this past month? Are you following the meal plan?", "category": "lifestyle"},
        {"id": "exercise", "text": "How much physical activity have you had? Do you exercise most days?", "category": "lifestyle"},
    ],
    "red_flag_criteria": [
        {"id": "high_glucose", "description": "Fasting glucose consistently above 300 mg/dL", "severity": "urgent"},
        {"id": "severe_fatigue", "description": "Report of severe, unexplained fatigue", "severity": "high"},
        {"id": "vision_changes", "description": "Vision changes or eye pain reported", "severity": "high"},
        {"id": "non_adherence", "description": "Consistent medication non-adherence reported", "severity": "high"},
    ],
    "education_talking_points": [
        "Importance of regular blood glucose monitoring and maintaining a log",
        "Dietary guidelines: managing carbohydrates, sugars, and portion sizes",
        "Regular physical activity benefits for blood sugar control",
        "Medication adherence is critical for preventing complications",
        "Warning signs: blurred vision, tingling in feet, excessive thirst",
    ],
    "medication_classes": ["Metformin", "GLP-1 agonists", "Sulfonylureas", "SGLT2 inhibitors", "Insulin"],
    "lab_reminder_defaults": {"HbA1c": 90, "fasting_glucose": 30},
    "escalation_instructions": "If the patient reports severe symptoms or consistent non-adherence, escalate to the care team immediately.",
    "default_followup_interval_days": 30,
}

HYPERTENSION_PROTOCOL = {
    "assessment_questions": [
        {"id": "blood_pressure", "text": "Have you been checking your blood pressure? What have your readings been?", "category": "symptom"},
        {"id": "headaches", "text": "Have you experienced any headaches, dizziness, or shortness of breath?", "category": "symptom"},
        {"id": "medication_adherence", "text": "Have you been taking your blood pressure medications as prescribed?", "category": "adherence"},
        {"id": "sodium_intake", "text": "How would you describe your salt intake? Are you limiting salty foods?", "category": "lifestyle"},
        {"id": "exercise", "text": "How much physical activity have you had this month?", "category": "lifestyle"},
        {"id": "stress", "text": "How would you describe your stress levels?", "category": "lifestyle"},
    ],
    "red_flag_criteria": [
        {"id": "severe_hypertension", "description": "BP consistently above 180/120 mmHg", "severity": "urgent"},
        {"id": "chest_pain", "description": "Chest pain or pressure reported", "severity": "urgent"},
        {"id": "severe_headache", "description": "Severe headache with vision changes", "severity": "high"},
    ],
    "education_talking_points": [
        "Home blood pressure monitoring and target ranges",
        "DASH diet: limiting sodium, increasing fruits and vegetables",
        "Regular physical activity (150 min/week) to lower BP",
        "Stress reduction techniques and their importance",
        "Medication compliance and avoiding skipped doses",
    ],
    "medication_classes": ["ACE inhibitors", "ARBs", "Beta-blockers", "Calcium channel blockers", "Diuretics"],
    "lab_reminder_defaults": {"BP_monitoring": 7, "kidney_function": 365},
    "escalation_instructions": "Severe hypertension (>180/120) or associated symptoms warrant immediate escalation.",
    "default_followup_interval_days": 14,
}

COPD_PROTOCOL = {
    "assessment_questions": [
        {"id": "shortness_of_breath", "text": "Have you experienced shortness of breath at rest or with minimal activity?", "category": "symptom"},
        {"id": "cough", "text": "Do you have a persistent cough? Is there any sputum production?", "category": "symptom"},
        {"id": "wheezing", "text": "Have you heard wheezing or felt chest tightness?", "category": "symptom"},
        {"id": "inhaler_technique", "text": "Are you using your inhalers correctly? How often are you using the rescue inhaler?", "category": "adherence"},
        {"id": "activity_tolerance", "text": "How far can you walk without becoming short of breath?", "category": "symptom"},
        {"id": "smoking", "text": "Have you continued to avoid smoking?", "category": "lifestyle"},
    ],
    "red_flag_criteria": [
        {"id": "severe_dyspnea", "description": "Severe shortness of breath at rest", "severity": "urgent"},
        {"id": "productive_cough", "description": "Cough with colored sputum or blood", "severity": "urgent"},
        {"id": "fever", "description": "Fever with respiratory symptoms", "severity": "high"},
    ],
    "education_talking_points": [
        "Proper inhaler and nebulizer technique is essential",
        "Vaccinations: flu and pneumococcal vaccines",
        "Smoking cessation resources and support",
        "Breathing exercises and energy conservation",
        "Recognizing signs of exacerbation early",
    ],
    "medication_classes": ["Bronchodilators", "Corticosteroids", "Combination inhalers"],
    "lab_reminder_defaults": {"spirometry": 365, "chest_xray": 730},
    "escalation_instructions": "Any signs of respiratory infection or severe dyspnea require immediate escalation.",
    "default_followup_interval_days": 21,
}

ASTHMA_PROTOCOL = {
    "assessment_questions": [
        {"id": "shortness_of_breath", "text": "Have you had any episodes of shortness of breath? How many this month?", "category": "symptom"},
        {"id": "night_symptoms", "text": "Have you woken up at night due to asthma symptoms?", "category": "symptom"},
        {"id": "triggers", "text": "What are your known asthma triggers? Have you been exposed to them?", "category": "symptom"},
        {"id": "rescue_inhaler_use", "text": "How often are you using your rescue inhaler? (More than 2 times/week suggests poor control)", "category": "adherence"},
        {"id": "controller_medication", "text": "Are you taking your controller medication as prescribed?", "category": "adherence"},
        {"id": "activity_level", "text": "Are you able to exercise without triggering asthma symptoms?", "category": "lifestyle"},
    ],
    "red_flag_criteria": [
        {"id": "severe_attack", "description": "Severe asthma attack with shortness of breath at rest", "severity": "urgent"},
        {"id": "blue_lips", "description": "Cyanosis or lips turning blue", "severity": "urgent"},
        {"id": "poor_control", "description": "Using rescue inhaler more than 2 times per week", "severity": "high"},
    ],
    "education_talking_points": [
        "Identifying and avoiding personal asthma triggers",
        "Proper inhaler technique and peak flow monitoring",
        "Action plan for symptom escalation",
        "When to seek emergency care (severe attacks)",
        "Role of controller vs. rescue medications",
    ],
    "medication_classes": ["Short-acting beta-agonists", "Long-acting beta-agonists", "Inhaled corticosteroids", "Leukotriene modifiers"],
    "lab_reminder_defaults": {"spirometry": 365, "allergy_testing": 730},
    "escalation_instructions": "Severe attacks or poor control despite treatment should be escalated for care plan adjustment.",
    "default_followup_interval_days": 30,
}
