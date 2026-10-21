package dev.amll.hub.android.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 尺寸与字号 token */
object Space {
    val xxs = 4.dp
    val xs = 6.dp
    val s = 8.dp
    val m = 10.dp
    val l = 12.dp
    val xl = 14.dp
    val xxl = 16.dp
    val page = 20.dp
    val hero = 18.dp
}

object Radius {
    val field = 12.dp
    val chip = 14.dp
    val card = 18.dp
    val hero = 22.dp
    val sheet = 24.dp
    val pill = 26.dp
    val pillOuter = 36.dp
}

object Size {
    val pageWidth = 390.dp
    val statusBar = 62.dp
    val tabBar = 95.dp
    val tabPill = 62.dp
    val topBar = 32.dp
    val coverRow = 48.dp
    val coverRank = 40.dp
}

/** 基础字号 */
object Font {
    private val Sans = FontFamily.SansSerif

    val pageTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 24.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 30.sp,
    )
    val navTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 18.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 24.sp,
    )
    val sheetTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 22.sp,
    )
    val section = TextStyle(
        fontFamily = Sans,
        fontSize = 15.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 20.sp,
    )
    val cardTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 18.sp,
    )
    val body = TextStyle(
        fontFamily = Sans,
        fontSize = 13.5.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 19.sp,
    )
    val bodyMedium = TextStyle(
        fontFamily = Sans,
        fontSize = 13.5.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 18.sp,
    )
    val bodySmall = TextStyle(
        fontFamily = Sans,
        fontSize = 11.5.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 16.sp,
    )
    val caption = TextStyle(
        fontFamily = Sans,
        fontSize = 11.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 15.sp,
    )
    val micro = TextStyle(
        fontFamily = Sans,
        fontSize = 10.sp,
        fontWeight = FontWeight.Normal,
        lineHeight = 14.sp,
    )
    val tabLabel = TextStyle(
        fontFamily = Sans,
        fontSize = 10.sp,
        fontWeight = FontWeight.Medium,
        lineHeight = 13.sp,
    )
    val numberL = TextStyle(
        fontFamily = Sans,
        fontSize = 20.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 24.sp,
    )
    val numberXL = TextStyle(
        fontFamily = Sans,
        fontSize = 32.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 36.sp,
    )
}

val CardShape = RoundedCornerShape(Radius.card)
val HeroShape = RoundedCornerShape(Radius.hero)
val FieldShape = RoundedCornerShape(Radius.field)
val ChipShape = RoundedCornerShape(Radius.chip)
val PillShape = RoundedCornerShape(Radius.pill)
val PillOuterShape = RoundedCornerShape(Radius.pillOuter)
