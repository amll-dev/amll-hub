package dev.amll.hub.android.ui.theme

import androidx.compose.material3.Typography

/**
 * M3 Typography 只做 [Font] token 的映射，不再维护第二套字号。
 * 这样 M3 组件与自绘组件落在同一档字号上（例如正文统一为 Font.body 13.5sp）。
 */
val AmllTypography = Typography(
    displayLarge = Font.numberXL,
    displayMedium = Font.numberL,
    displaySmall = Font.pageTitle,
    headlineLarge = Font.pageTitle,
    headlineMedium = Font.pageTitle,
    headlineSmall = Font.navTitle,
    titleLarge = Font.sheetTitle,
    titleMedium = Font.section,
    titleSmall = Font.cardTitle,
    bodyLarge = Font.body,
    bodyMedium = Font.body,
    bodySmall = Font.bodySmall,
    labelLarge = Font.bodyMedium,
    labelMedium = Font.caption,
    labelSmall = Font.micro,
)
